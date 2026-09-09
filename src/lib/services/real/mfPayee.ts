import "server-only";
import { getMemberService } from "@/lib/services";
import { MoneyForwardPayablesService, type MFBankAccountInput } from "./MoneyForwardPayablesService";
import type { Member } from "@/types";

export interface BankDetailsInput {
  bankAccountType: MFBankAccountInput["accountType"];
  bankCode: string;
  bankBranchCode: string;
  accountNumber: string;
  holderName: string;
  holderNameKana: string;
}

export interface CreatePayeeResult {
  payeeId: string;
  counterpartyId: string;
  createdAt: string;
  reused: boolean;
}

// Thrown when the submitter isn't a registered Member at all — bank details
// live on the Member record, so there's nowhere to save them without one.
export class MemberNotFoundError extends Error {}

// Thrown when the member exists but has no bank details on file yet — the
// caller should show a form and retry with `bankDetails` filled in.
export class NeedsBankDetailsError extends Error {
  constructor(public readonly memberName: string) {
    super(`No bank details on file for ${memberName}`);
  }
}

function payeeCodeFor(member: Member): string {
  const fromEmployeeCode = member.employeeCode?.trim().replace(/[^a-zA-Z0-9]/g, "");
  if (fromEmployeeCode) return fromEmployeeCode.slice(0, 20);
  return member.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20) || "payee";
}

/**
 * Resolves (or creates) the Money Forward Payables payee for a member,
 * identified by display name. Bank details are entered once and persisted
 * on the Member record — every subsequent call for the same person reuses
 * the existing payee/counterparty instead of creating a duplicate.
 *
 * Matched by name rather than email: submitters have used more than one
 * email address across submissions for the same person, while their name
 * on the submission has stayed consistent with the Member record. `email`
 * is a fallback for the inverse problem — some submissions have an email
 * address in the name field, which won't match anyone by name.
 */
export async function createOrReusePayeeForMember(
  memberName: string,
  bankDetails?: BankDetailsInput,
  email?: string
): Promise<CreatePayeeResult> {
  const memberService = getMemberService();
  let member = await memberService.getMemberByName(memberName);

  if (!member && email) {
    member = await memberService.getMemberByEmail(email);
  }

  if (!member) {
    throw new MemberNotFoundError(
      `No registered member found for ${memberName} — register them under Team → Members before creating a Money Forward payee.`
    );
  }

  if (member.mfPayeeId && member.mfCounterpartyId) {
    return {
      payeeId: member.mfPayeeId,
      counterpartyId: member.mfCounterpartyId,
      createdAt: member.mfPayeeCreatedAt ?? new Date().toISOString(),
      reused: true,
    };
  }

  // Only fill in bank details when the member doesn't already have complete
  // ones on file — a resolved-by-fuzzy-name-or-email match should never be
  // able to overwrite an existing member's bank account before their first
  // payee is created.
  const hasCompleteBankDetails =
    !!member.bankCode &&
    !!member.bankBranchCode &&
    !!member.bankAccountNumber &&
    !!member.bankHolderName &&
    !!member.bankHolderNameKana;

  if (bankDetails && !hasCompleteBankDetails) {
    member = {
      ...member,
      bankAccountType: bankDetails.bankAccountType,
      bankCode: bankDetails.bankCode,
      bankBranchCode: bankDetails.bankBranchCode,
      bankAccountNumber: bankDetails.accountNumber,
      bankHolderName: bankDetails.holderName,
      bankHolderNameKana: bankDetails.holderNameKana,
    };
    await memberService.saveMember(member);
  }

  if (
    !member.bankCode ||
    !member.bankBranchCode ||
    !member.bankAccountNumber ||
    !member.bankHolderName ||
    !member.bankHolderNameKana
  ) {
    throw new NeedsBankDetailsError(member.displayName);
  }

  const payables = new MoneyForwardPayablesService();
  const result = await payables.createPayeeWithBankAccount({
    counterpartyName: member.displayName,
    payeeName: member.displayName,
    payeeCode: payeeCodeFor(member),
    bankAccount: {
      accountType: member.bankAccountType ?? "ordinary",
      bankCode: member.bankCode,
      bankBranchCode: member.bankBranchCode,
      accountNumber: member.bankAccountNumber,
      holderName: member.bankHolderName,
      holderNameKana: member.bankHolderNameKana,
    },
  });

  const createdAt = new Date().toISOString();
  await memberService.saveMember({
    ...member,
    mfCounterpartyId: result.counterpartyId,
    mfPayeeId: result.payeeId,
    mfPayeeCreatedAt: createdAt,
  });

  return { payeeId: result.payeeId, counterpartyId: result.counterpartyId, createdAt, reused: false };
}
