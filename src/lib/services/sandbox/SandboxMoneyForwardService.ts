import "server-only";
import type { IMoneyForwardService, MoneyForwardSendResult, MFSendPayload } from "../types";
import type { ExpenseClaim } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// SandboxMoneyForwardService.ts — sends the exact same partner/billing JSON
// structure as the real MoneyForwardService (../real/MoneyForwardService.ts),
// but to a local sandbox endpoint (src/app/api/dev/sandbox-mf) instead of the
// production Money Forward API. Use this to exercise the real request shape
// end-to-end — no OAuth credentials needed, and nothing touches the real MF
// account.
//
// Env var:
//   SANDBOX_MF_BASE_URL   Base URL for the sandbox endpoint.
//                         Defaults to http://localhost:3000/api/dev/sandbox-mf
// ─────────────────────────────────────────────────────────────────────────────

const SANDBOX_BASE =
  process.env.SANDBOX_MF_BASE_URL ?? "http://localhost:3000/api/dev/sandbox-mf";

export class SandboxMoneyForwardService implements IMoneyForwardService {
  async sendInvoice(payload: MFSendPayload): Promise<MoneyForwardSendResult> {
    const partnerId = await this.findOrCreatePartner(payload.partnerName);
    return this.createBilling(partnerId, payload);
  }

  async sendExpenseReimbursement(claim: ExpenseClaim): Promise<MoneyForwardSendResult> {
    return this.sendInvoice({
      partnerName: claim.submittedBy,
      title: `Expense Reimbursement — ${claim.description || claim.category}`,
      billingDate: claim.expenseDate || new Date().toISOString().slice(0, 10),
      amount: claim.amount,
      currency: claim.currency === "USD" ? "USD" : "JPY",
      memo: claim.reviewerComment || claim.description || "",
    });
  }

  // ── Partner (取引先) management — mirrors MoneyForwardService ────────────────

  private async findOrCreatePartner(name: string): Promise<string> {
    const list = await this.apiFetch<{ partners: Array<{ id: string; name: string }> }>(
      "GET",
      `/partners?name=${encodeURIComponent(name)}`
    );

    const match = list.partners?.find(
      (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (match) return match.id;

    const created = await this.apiFetch<{ partner: { id: string } }>(
      "POST",
      "/partners",
      { partner: { name } }
    );
    return created.partner.id;
  }

  // ── Billing (受取請求書) creation — mirrors MoneyForwardService ─────────────

  private async createBilling(
    partnerId: string,
    payload: MFSendPayload
  ): Promise<MoneyForwardSendResult> {
    const body = {
      billing: {
        partner_id: partnerId,
        title: payload.title,
        billing_date: payload.billingDate,
        due_date: payload.dueDate ?? null,
        memo: payload.memo ?? "",
        currency: payload.currency ?? "JPY",
        items: [
          {
            name: payload.title,
            quantity: 1,
            unit_price: payload.amount,
            tax_type: "inclusive",
          },
        ],
      },
    };

    const res = await this.apiFetch<{ billing: { id: string; web_url?: string } }>(
      "POST",
      "/billings",
      body
    );

    return {
      billingId: res.billing.id,
      billingUrl: res.billing.web_url ?? `${SANDBOX_BASE}/billings/${res.billing.id}`,
    };
  }

  // ── HTTP helper ─────────────────────────────────────────────────────────────

  private async apiFetch<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${SANDBOX_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      let detail = "";
      try { detail = await res.text(); } catch { /* ignore */ }
      throw new Error(`Sandbox MF ${method} ${path} → ${res.status}: ${detail}`);
    }

    return res.json() as Promise<T>;
  }
}
