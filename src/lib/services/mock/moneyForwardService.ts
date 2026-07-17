import "server-only";
import type { IMoneyForwardService, MoneyForwardSendResult, MFSendPayload } from "../types";
import type { ExpenseClaim } from "@/types";

// Simulates Money Forward Cloud Invoice without calling the real API, so both
// the expense-approval flow and the vendor-invoice "send to MF" flow can be
// tested end-to-end before real MF OAuth credentials (MF_ACCESS_TOKEN etc.)
// are wired up.
export class MockMoneyForwardService implements IMoneyForwardService {
  async sendExpenseReimbursement(claim: ExpenseClaim): Promise<MoneyForwardSendResult> {
    console.log(
      `[MockMoneyForwardService] Simulated expense send — ${claim.submittedBy}: ` +
      `${claim.currency} ${claim.amount.toLocaleString()} (${claim.description || claim.category})`
    );
    const billingId = `mock-exp-${claim.id}`;
    return {
      billingId,
      billingUrl: `/mock/mf-billing/${billingId}`,
    };
  }

  async sendInvoice(payload: MFSendPayload): Promise<MoneyForwardSendResult> {
    console.log(
      `[MockMoneyForwardService] Simulated invoice send — ${payload.partnerName}: ` +
      `${payload.currency ?? "JPY"} ${payload.amount.toLocaleString()} (${payload.title})`
    );
    const billingId = `mock-inv-${Buffer.from(`${payload.partnerName}-${payload.billingDate}-${payload.amount}`).toString("base64url").slice(0, 16)}`;
    return {
      billingId,
      billingUrl: `/mock/mf-billing/${billingId}`,
    };
  }
}
