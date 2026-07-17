import type { IExpenseService } from "../types";
import type { ExpenseClaim, ExpenseStatus, ExpenseValidationResult } from "@/types";
import {
  loadExpenseClaims,
  saveExpenseClaim,
  deleteExpenseClaim,
  updateExpenseClaimStatus,
} from "./fileStore";
import { extractReceiptFields, validateExpenseData } from "@/lib/services/ai/receiptExtractor";

export class MockExpenseService implements IExpenseService {
  async listClaims(filters?: { status?: ExpenseStatus; submittedBy?: string }): Promise<ExpenseClaim[]> {
    let list = loadExpenseClaims();
    if (filters?.status)      list = list.filter((c) => c.status === filters.status);
    if (filters?.submittedBy) list = list.filter((c) => c.submittedBy === filters.submittedBy);
    return list.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  async getClaim(id: string): Promise<ExpenseClaim | null> {
    return loadExpenseClaims().find((c) => c.id === id) ?? null;
  }

  async saveClaim(claim: ExpenseClaim): Promise<void> {
    saveExpenseClaim(claim);
  }

  async deleteClaim(id: string): Promise<void> {
    deleteExpenseClaim(id);
  }

  async updateStatus(id: string, status: ExpenseStatus, actorName: string, comment?: string): Promise<void> {
    updateExpenseClaimStatus(id, status, actorName, comment);
  }

  async validateClaim(claim: ExpenseClaim): Promise<ExpenseValidationResult> {
    const TRANSPORT_NO_RECEIPT = /[→↔]|電車|バス|train|bus|subway|公共交通|metro|路線/i;
    const isNoReceiptTransport =
      claim.category === "transport" && TRANSPORT_NO_RECEIPT.test(claim.description ?? "");

    const violations: string[] = [];
    if (!claim.receiptUrl && !claim.receiptFilename && !isNoReceiptTransport) {
      violations.push("MISSING_RECEIPT");
    }
    if (claim.amount > 100000 && claim.paymentMethod === "personal_reimbursement") {
      violations.push("HIGH_AMOUNT_PERSONAL_REIMBURSEMENT");
    }
    if (claim.amount > 1000000) violations.push("REQUIRES_MANAGEMENT_APPROVAL");

    // A receipt attached to the claim is read by GPT-4o so a purpose written
    // on the receipt (但し書き) can satisfy the purpose requirement even when
    // the submitter left the form's description field blank.
    let extractedAmount    = claim.extractedAmount;
    let extractedDate      = claim.extractedDate;
    let extractedVendor    = claim.extractedVendor;
    let extractedRecipient = claim.extractedRecipient ?? null;
    let extractedPurpose   = claim.extractedPurpose ?? null;
    let purposeSatisfied   = !!claim.description;
    let receiptFound       = false;

    if (claim.receiptUrl) {
      try {
        const extracted = await extractReceiptFields(claim.receiptUrl);
        receiptFound       = true;
        extractedAmount    = extracted.amount;
        extractedDate      = extracted.date;
        extractedVendor    = extracted.vendor;
        extractedRecipient = extracted.recipient;
        extractedPurpose   = extracted.purpose;
        if (extractedPurpose) purposeSatisfied = true;

        if (extractedAmount !== null && Math.abs(extractedAmount - claim.amount) > 1) {
          violations.push("AMOUNT_MISMATCH");
        }
        if (extractedDate && claim.expenseDate) {
          const diffMs = Math.abs(new Date(extractedDate).getTime() - new Date(claim.expenseDate).getTime());
          if (diffMs > 86400000) violations.push("DATE_MISMATCH");
        }
        // Receipt recipient (宛名) is often the company, not the submitter —
        // shown for reference in the UI but not checked against submittedBy.
      } catch (err) {
        console.warn("[MockExpenseService.validateClaim] receipt extraction failed:", err);
      }
    }

    if (!receiptFound && !purposeSatisfied) {
      try {
        const gpt = await validateExpenseData({
          submittedBy:   claim.submittedBy,
          amount:        claim.amount,
          currency:      claim.currency,
          expenseDate:   claim.expenseDate,
          category:      claim.category,
          description:   claim.description ?? "",
          paymentMethod: claim.paymentMethod,
          hasReceipt:    !!(claim.receiptUrl || claim.receiptFilename),
        });
        for (const v of gpt.violations) if (!violations.includes(v)) violations.push(v);
      } catch (err) {
        console.warn("[MockExpenseService.validateClaim] text validation failed:", err);
      }
    }

    if (!purposeSatisfied) violations.push("MISSING_PURPOSE");

    const receiptMissing = !claim.receiptUrl && !claim.receiptFilename && !isNoReceiptTransport;
    const riskLevel =
      violations.includes("MISSING_RECEIPT") || violations.includes("MISSING_PURPOSE")
        ? "BLOCKED"
        : violations.length > 0
        ? "NEEDS_REVIEW"
        : "OK";

    // Persist updated violations and extracted fields back to disk
    saveExpenseClaim({
      ...claim,
      extractedAmount,
      extractedDate,
      extractedVendor,
      extractedRecipient,
      extractedPurpose,
      policyViolations: violations,
      updatedAt: new Date().toISOString(),
    });

    return {
      claimId:              claim.id,
      receiptAccessible:    receiptFound,
      amountMatchesReceipt: extractedAmount === null || Math.abs(extractedAmount - claim.amount) <= 1,
      dateFound:            !!extractedDate || !!claim.expenseDate,
      categoryValid:        !violations.includes("CATEGORY_MISMATCH"),
      receiptMissing,
      policyViolations:     violations,
      riskLevel,
      statusCode:           claim.status,
      extractedAmount,
      extractedDate,
      extractedVendor,
      extractedRecipient,
      extractedPurpose,
    };
  }
}
