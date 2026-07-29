import "server-only";
import { getSupabaseClient } from "@/lib/supabase";

const MF_API_BASE       = "https://payable.moneyforward.com/api/external/v1";
const MF_AUTHORIZE_URL  = "https://payable.moneyforward.com/oauth/authorize";
const MF_TOKEN_URL      = "https://payable.moneyforward.com/oauth/token";
const TOKENS_FILE       = "payables_tokens.json"; // separate from the Invoice integration's tokens.json

export interface MFBankAccountInput {
  accountType: "ordinary" | "checking" | "saving" | "other";
  bankCode: string;
  bankBranchCode: string;
  accountNumber: string;
  holderName: string;
  holderNameKana: string;
}

export interface MFPayeeInput {
  counterpartyName: string;
  payeeName: string;
  payeeCode: string;
  bankAccount: MFBankAccountInput;
  paymentMethod?:
    | "bank_transfer" | "cash" | "payment_slip" | "direct_debit" | "credit_card"
    | "prepaid_card" | "check" | "promissory_note" | "densai" | "remittance_abroad" | "other";
}

export interface MFPayeeResult {
  counterpartyId: string;
  counterpartyAccountId: string;
  payeeId: string;
}

export class MoneyForwardPayablesService {
  private accessToken: string = "";
  private refreshToken: string = "";
  private readonly clientId: string;
  private readonly clientSecret: string;
  private tokensLoaded = false;
  private officeId: string | null = null;

  constructor() {
    const clientId     = process.env.MF_PAYABLES_CLIENT_ID;
    const clientSecret = process.env.MF_PAYABLES_CLIENT_SECRET;
    if (!clientId)     throw new Error("[MoneyForwardPayablesService] MF_PAYABLES_CLIENT_ID not set");
    if (!clientSecret) throw new Error("[MoneyForwardPayablesService] MF_PAYABLES_CLIENT_SECRET not set");
    this.clientId     = clientId;
    this.clientSecret = clientSecret;
  }

  private async ensureTokens(): Promise<void> {
    if (this.tokensLoaded) return;
    let source = "none";
    try {
      const db = getSupabaseClient();
      const { data, error } = await db.storage.from("mf-config").download(TOKENS_FILE);
      if (error) {
        source = `storage-error:${JSON.stringify(error)}`;
        this.accessToken  = process.env.MF_PAYABLES_ACCESS_TOKEN  || "";
        this.refreshToken = process.env.MF_PAYABLES_REFRESH_TOKEN || "";
      } else if (data) {
        const text = Buffer.from(await data.arrayBuffer()).toString("utf-8");
        const tokens = JSON.parse(text) as { access?: string; refresh?: string };
        this.accessToken  = tokens.access  || process.env.MF_PAYABLES_ACCESS_TOKEN  || "";
        this.refreshToken = tokens.refresh || process.env.MF_PAYABLES_REFRESH_TOKEN || "";
        source = tokens.access ? "storage" : "env-fallback";
      } else {
        source = "no-data";
        this.accessToken  = process.env.MF_PAYABLES_ACCESS_TOKEN  || "";
        this.refreshToken = process.env.MF_PAYABLES_REFRESH_TOKEN || "";
      }
    } catch (e) {
      source = `exception:${String(e)}`;
      this.accessToken  = process.env.MF_PAYABLES_ACCESS_TOKEN  || "";
      this.refreshToken = process.env.MF_PAYABLES_REFRESH_TOKEN || "";
    }
    this.tokensLoaded = true;
    if (!this.accessToken) {
      throw new Error(`[MoneyForwardPayablesService] MF_PAYABLES_ACCESS_TOKEN not set (source=${source})`);
    }
  }

  private async persistTokens(): Promise<void> {
    try {
      const db = getSupabaseClient();
      const payload = JSON.stringify({ access: this.accessToken, refresh: this.refreshToken });
      await db.storage.from("mf-config").upload(TOKENS_FILE, payload, {
        upsert: true,
        contentType: "application/json",
      });
    } catch (err) {
      console.warn("[MoneyForwardPayablesService] Could not persist tokens:", err);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Creates a counterparty (取引先), its bank account, and a payee (支払先)
   * pointing at that account — the same three writes the debt_creditors/new
   * screen performs, done via API instead of the form.
   */
  async createPayeeWithBankAccount(input: MFPayeeInput): Promise<MFPayeeResult> {
    const counterpartyId = await this.findOrCreateCounterparty(input.counterpartyName);
    const counterpartyAccountId = await this.createCounterpartyAccount(counterpartyId, input.bankAccount);
    const payeeId = await this.createPayee(counterpartyId, counterpartyAccountId, input);
    return { counterpartyId, counterpartyAccountId, payeeId };
  }

  // ── Office (事業者) resolution ──────────────────────────────────────────────
  // Every other endpoint is nested under /offices/{office_id} — this account
  // has exactly one office (Robo Co-op), so we cache the first one returned.

  async listOffices(): Promise<Array<{ id: string; name: string }>> {
    const list = await this.apiFetch<{ offices: Array<{ id: string; name: string }> }>(
      "GET",
      "/offices"
    );
    return list.offices ?? [];
  }

  async listExItems(): Promise<unknown[]> {
    const officeId = await this.getOfficeId();
    const res = await this.apiFetch<{ ex_items: unknown[] }>("GET", `/offices/${officeId}/ex_items`);
    return res.ex_items ?? [];
  }

  async listInvoiceReportTransactionItems(): Promise<unknown[]> {
    const officeId = await this.getOfficeId();
    const res = await this.apiFetch<{ transaction_items: unknown[] }>(
      "GET",
      `/offices/${officeId}/invoice_report_transaction_items`
    );
    return res.transaction_items ?? [];
  }

  // ── Invoice transaction (支払明細) line items ────────────────────────────────
  // NOTE: only creatable inside an EXISTING invoice_report (支払依頼) — there is
  // no endpoint in this API to create the report itself, only GET.

  async createInvoiceTransaction(
    invoiceReportId: string,
    input: { name: string; exItemId: string; crItemId: string; totalValue: number; dealDate: string }
  ): Promise<Record<string, unknown>> {
    const officeId = await this.getOfficeId();
    return this.apiFetch<Record<string, unknown>>(
      "POST",
      `/offices/${officeId}/invoice_reports/${invoiceReportId}/invoice_transactions`,
      {
        ap_invoice_transaction: {
          name: input.name,
          ex_item_id: input.exItemId,
          cr_item_id: input.crItemId,
          total_value: input.totalValue,
          deal_date: input.dealDate,
        },
      }
    );
  }

  async deleteInvoiceTransaction(invoiceReportId: string, transactionId: string): Promise<void> {
    const officeId = await this.getOfficeId();
    await this.apiFetch<void>(
      "DELETE",
      `/offices/${officeId}/invoice_reports/${invoiceReportId}/invoice_transactions/${transactionId}`
    );
  }

  async listTransactionItemOptions(transactionItemId: string): Promise<unknown[]> {
    const officeId = await this.getOfficeId();
    const res = await this.apiFetch<{ options: unknown[] }>(
      "GET",
      `/offices/${officeId}/invoice_report_transaction_items/${transactionItemId}/options`
    );
    return res.options ?? [];
  }

  async listCounterparties(): Promise<Array<{ id: string; name: string; code: string }>> {
    const officeId = await this.getOfficeId();
    const res = await this.apiFetch<{ counterparties: Array<{ id: string; name: string; code: string }> }>(
      "GET",
      `/offices/${officeId}/counterparties`
    );
    return res.counterparties ?? [];
  }

  async listPayees(counterpartyId: string): Promise<unknown[]> {
    const officeId = await this.getOfficeId();
    const res = await this.apiFetch<{ payees: unknown[] }>(
      "GET",
      `/offices/${officeId}/counterparties/${counterpartyId}/payees`
    );
    return res.payees ?? [];
  }

  async listInvoiceReports(): Promise<Array<{ id: string; title: string; status: string }>> {
    const officeId = await this.getOfficeId();
    const list = await this.apiFetch<{ invoice_reports: Array<{ id: string; title: string; status: string }> }>(
      "GET",
      `/offices/${officeId}/invoice_reports`
    );
    return list.invoice_reports ?? [];
  }

  private async getOfficeId(): Promise<string> {
    if (this.officeId) return this.officeId;
    const offices = await this.listOffices();
    const office = offices[0];
    if (!office) throw new Error("[MoneyForwardPayablesService] No offices returned for this account");
    this.officeId = office.id;
    return office.id;
  }

  // ── Counterparty (取引先) management ────────────────────────────────────────
  // NOTE: the list endpoint only supports filtering by `ids[]`, not by name —
  // MF has no server-side name search here. This does a client-side scan of
  // the first page, matching the Invoice integration's find-or-create intent,
  // but won't catch a match sitting on page 2+.

  private async findOrCreateCounterparty(name: string): Promise<string> {
    const officeId = await this.getOfficeId();
    const list = await this.apiFetch<{ counterparties: Array<{ id: string; name: string }> }>(
      "GET",
      `/offices/${officeId}/counterparties`
    );

    const match = list.counterparties?.find(
      (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (match) return match.id;

    const created = await this.apiFetch<{ id: string }>(
      "POST",
      `/offices/${officeId}/counterparties`,
      {
        counterparty: {
          name,
          code: name.replace(/\s+/g, "_").toLowerCase().slice(0, 20),
          is_domestic: true,
          is_antisocial_checked: false,
          register_type: "unknown",
          is_enable_output_payment_record: false,
          subcontract_type: "unknown",
          company_type: "unknown",
        },
      }
    );
    return created.id;
  }

  // ── Counterparty bank account (取引先口座) ──────────────────────────────────

  private async createCounterpartyAccount(
    counterpartyId: string,
    account: MFBankAccountInput
  ): Promise<string> {
    const officeId = await this.getOfficeId();
    const created = await this.apiFetch<{ id: string }>(
      "POST",
      `/offices/${officeId}/counterparties/${counterpartyId}/counterparty_accounts`,
      {
        counterparty_account: {
          account_type: account.accountType,
          number: account.accountNumber,
          holder_name: account.holderName,
          holder_name_kana: account.holderNameKana,
          bank_code: account.bankCode,
          bank_branch_code: account.bankBranchCode,
        },
      }
    );
    return created.id;
  }

  // ── Payee (支払先) creation ──────────────────────────────────────────────────

  private async createPayee(
    counterpartyId: string,
    counterpartyAccountId: string,
    input: MFPayeeInput
  ): Promise<string> {
    const officeId = await this.getOfficeId();
    const created = await this.apiFetch<{ id: string }>(
      "POST",
      `/offices/${officeId}/counterparties/${counterpartyId}/payees`,
      {
        payee: {
          name: input.payeeName,
          code: input.payeeCode,
          payment_method: input.paymentMethod ?? "bank_transfer",
          counterparty_account_id: counterpartyAccountId,
          payment_closing_date: 31,
          payment_month: 1,
          payment_due_date: 31,
          payment_holiday_rule: "behind",
          is_transfer_fee_on: false,
          priority: 1,
          is_active: true,
          payee_withholding_tax_setting_is_active: false,
          payee_invoice_transaction_default_value_is_tax_included: true,
          withholding_tax_setting: {},
          invoice_transaction_default_value: {},
        },
      }
    );
    return created.id;
  }

  // ── HTTP helper ─────────────────────────────────────────────────────────────

  private async apiFetch<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown
  ): Promise<T> {
    await this.ensureTokens();
    const url = `${MF_API_BASE}${path}`;

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };

    let res = await fetch(url, init);

    if (res.status === 401 && this.refreshToken) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        init.headers = {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${this.accessToken}`,
        };
        res = await fetch(url, init);
      }
    }

    if (!res.ok) {
      let detail = "";
      try { detail = await res.text(); } catch { /* ignore */ }
      throw new Error(`MF Payables API ${method} ${path} → ${res.status}: ${detail}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async tryRefreshToken(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      const res = await fetch(MF_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:    "refresh_token",
          refresh_token: this.refreshToken,
          client_id:     this.clientId,
          client_secret: this.clientSecret,
        }),
      });
      if (!res.ok) return false;
      const data = await res.json() as { access_token: string; refresh_token?: string };
      this.accessToken = data.access_token;
      if (data.refresh_token) this.refreshToken = data.refresh_token;
      await this.persistTokens();
      return true;
    } catch {
      return false;
    }
  }
}

// ── Static OAuth helpers (used by auth routes) ──────────────────────────────

export function buildMFPayablesAuthUrl(): string {
  const clientId    = process.env.MF_PAYABLES_CLIENT_ID    ?? "";
  const redirectUri = process.env.MF_PAYABLES_REDIRECT_URI ?? "";
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     clientId,
    redirect_uri:  redirectUri,
    scope:         "office_setting:write user_setting:write",
  });
  return `${MF_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeMFPayablesCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const res = await fetch(MF_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      client_id:     process.env.MF_PAYABLES_CLIENT_ID     ?? "",
      client_secret: process.env.MF_PAYABLES_CLIENT_SECRET ?? "",
      redirect_uri:  process.env.MF_PAYABLES_REDIRECT_URI  ?? "",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MF Payables token exchange failed ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresIn:    data.expires_in,
  };
}
