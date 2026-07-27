import "server-only";
import { getSupabaseClient } from "@/lib/supabase";

const MF_API_BASE = "https://invoice.moneyforward.com/api/v3";
const MF_AUTHORIZE_URL = "https://api.biz.moneyforward.com/authorize";
const MF_TOKEN_URL = "https://api.biz.moneyforward.com/token";

export interface MFSendPayload {
  partnerName: string;
  title: string;
  billingDate: string;   // YYYY-MM-DD
  dueDate?: string;      // YYYY-MM-DD
  amount: number;        // tax-included total
  currency?: "JPY" | "USD";
  memo?: string;
  pdfData?: Uint8Array;
  pdfFilename?: string;
}

export interface MFSendResult {
  billingId: string;
  billingUrl: string;
  partnerId: string;
}

export class MoneyForwardService {
  private accessToken: string = "";
  private refreshToken: string = "";
  private readonly clientId: string;
  private readonly clientSecret: string;
  private tokensLoaded = false;

  constructor() {
    const clientId     = process.env.MF_CLIENT_ID;
    const clientSecret = process.env.MF_CLIENT_SECRET;
    if (!clientId)     throw new Error("[MoneyForwardService] MF_CLIENT_ID not set");
    if (!clientSecret) throw new Error("[MoneyForwardService] MF_CLIENT_SECRET not set");
    this.clientId     = clientId;
    this.clientSecret = clientSecret;
  }

  private async ensureTokens(): Promise<void> {
    if (this.tokensLoaded) return;
    try {
      const db = getSupabaseClient();
      const { data } = await db
        .from("app_config")
        .select("mf_access_token, mf_refresh_token")
        .eq("id", "main")
        .single();
      this.accessToken  = (data as Record<string, string> | null)?.mf_access_token  || process.env.MF_ACCESS_TOKEN  || "";
      this.refreshToken = (data as Record<string, string> | null)?.mf_refresh_token || process.env.MF_REFRESH_TOKEN || "";
    } catch {
      this.accessToken  = process.env.MF_ACCESS_TOKEN  || "";
      this.refreshToken = process.env.MF_REFRESH_TOKEN || "";
    }
    this.tokensLoaded = true;
    if (!this.accessToken) {
      throw new Error("[MoneyForwardService] MF_ACCESS_TOKEN not set. Complete the OAuth flow at /api/auth/moneyforward");
    }
  }

  private async persistTokens(): Promise<void> {
    try {
      const db = getSupabaseClient();
      await db.from("app_config").update({
        mf_access_token:  this.accessToken,
        mf_refresh_token: this.refreshToken,
      }).eq("id", "main");
    } catch (err) {
      console.warn("[MoneyForwardService] Could not persist tokens to Supabase:", err);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async sendInvoice(payload: MFSendPayload): Promise<MFSendResult> {
    const partnerId = await this.findOrCreatePartner(payload.partnerName);
    const result    = await this.createBilling(partnerId, payload);
    return result;
  }

  // ── Partner (取引先) management ─────────────────────────────────────────────

  private async findOrCreatePartner(name: string): Promise<string> {
    // Search by name
    const list = await this.apiFetch<{ partners: Array<{ id: string; name: string }> }>(
      `GET`,
      `/partners?name=${encodeURIComponent(name)}`
    );

    const match = list.partners?.find(
      (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (match) return match.id;

    // Create new partner
    const created = await this.apiFetch<{ partner: { id: string } }>(
      `POST`,
      `/partners`,
      { partner: { name } }
    );
    return created.partner.id;
  }

  // ── Billing (受取請求書) creation ───────────────────────────────────────────

  private async createBilling(
    partnerId: string,
    payload: MFSendPayload
  ): Promise<MFSendResult> {
    const body = {
      billing: {
        partner_id:    partnerId,
        title:         payload.title,
        billing_date:  payload.billingDate,
        due_date:      payload.dueDate ?? null,
        memo:          payload.memo ?? "",
        currency: payload.currency ?? "JPY",
        items: [
          {
            name:       payload.title,
            quantity:   1,
            unit_price: payload.amount,
            tax_type:   "inclusive",
          },
        ],
      },
    };

    const res = await this.apiFetch<{
      billing: { id: string; pdf_url?: string; web_url?: string };
    }>(`POST`, `/billings`, body);

    const id  = res.billing.id;
    const url = res.billing.web_url
      ?? res.billing.pdf_url
      ?? `https://invoice.moneyforward.com/billings/${id}`;

    return { billingId: id, billingUrl: url, partnerId };
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

    // Attempt token refresh on 401
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
      throw new Error(`MF API ${method} ${path} → ${res.status}: ${detail}`);
    }

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

export function buildMFAuthUrl(): string {
  const clientId    = process.env.MF_CLIENT_ID    ?? "";
  const redirectUri = process.env.MF_REDIRECT_URI ?? "";
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     clientId,
    redirect_uri:  redirectUri,
    scope:         "mfc/invoice/data.write",
  });
  return `${MF_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeMFCode(code: string): Promise<{
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
      client_id:     process.env.MF_CLIENT_ID     ?? "",
      client_secret: process.env.MF_CLIENT_SECRET ?? "",
      redirect_uri:  process.env.MF_REDIRECT_URI  ?? "",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MF token exchange failed ${res.status}: ${err}`);
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
