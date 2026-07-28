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
    let source = "none";
    try {
      const db = getSupabaseClient();
      const { data, error } = await db.storage.from("mf-config").download("tokens.json");
      if (error) {
        source = `storage-error:${JSON.stringify(error)}`;
        this.accessToken  = process.env.MF_ACCESS_TOKEN  || "";
        this.refreshToken = process.env.MF_REFRESH_TOKEN || "";
      } else if (data) {
        const text = Buffer.from(await data.arrayBuffer()).toString("utf-8");
        const tokens = JSON.parse(text) as { access?: string; refresh?: string };
        this.accessToken  = tokens.access  || process.env.MF_ACCESS_TOKEN  || "";
        this.refreshToken = tokens.refresh || process.env.MF_REFRESH_TOKEN || "";
        source = tokens.access ? "storage" : "env-fallback";
      } else {
        source = "no-data";
        this.accessToken  = process.env.MF_ACCESS_TOKEN  || "";
        this.refreshToken = process.env.MF_REFRESH_TOKEN || "";
      }
    } catch (e) {
      source = `exception:${String(e)}`;
      this.accessToken  = process.env.MF_ACCESS_TOKEN  || "";
      this.refreshToken = process.env.MF_REFRESH_TOKEN || "";
    }
    this.tokensLoaded = true;
    if (!this.accessToken) {
      throw new Error(`[MoneyForwardService] MF_ACCESS_TOKEN not set (source=${source})`);
    }
  }

  private async persistTokens(): Promise<void> {
    try {
      const db = getSupabaseClient();
      const payload = JSON.stringify({ access: this.accessToken, refresh: this.refreshToken });
      await db.storage.from("mf-config").upload("tokens.json", payload, {
        upsert: true,
        contentType: "application/json",
      });
    } catch (err) {
      console.warn("[MoneyForwardService] Could not persist tokens:", err);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async sendInvoice(payload: MFSendPayload): Promise<MFSendResult> {
    const partnerId = await this.findOrCreatePartner(payload.partnerName);
    const result    = await this.createBilling(partnerId, payload);
    return result;
  }

  // ── Department (取引先部署) management ──────────────────────────────────────
  // NOTE: department_id on a billing refers to the PARTNER's department (a
  // contact/billing-address block on the client), not our own office. MF's
  // API has no "our office's departments" resource — GET /departments and
  // GET /offices (used here previously) don't exist and always 404.

  private async findOrCreateDepartment(partnerId: string, partnerName: string): Promise<string> {
    const list = await this.apiFetch<{ data: Array<{ id: string }> }>(
      `GET`,
      `/partners/${partnerId}/departments`
    );

    const existingId = list.data?.[0]?.id;
    if (existingId) return existingId;

    const created = await this.apiFetch<{ id: string }>(
      `POST`,
      `/partners/${partnerId}/departments`,
      { person_name: partnerName }
    );
    return created.id;
  }

  // ── Partner (取引先) management ─────────────────────────────────────────────

  private async findOrCreatePartner(name: string): Promise<string> {
    const list = await this.apiFetch<{ data: Array<{ id: string; name: string }> }>(
      `GET`,
      `/partners?name=${encodeURIComponent(name)}`
    );

    const match = list.data?.find(
      (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (match) return match.id;

    const created = await this.apiFetch<{ id: string }>(
      `POST`,
      `/partners`,
      { name }
    );
    return created.id;
  }

  // ── Billing (請求書) creation ───────────────────────────────────────────────

  private async createBilling(
    partnerId: string,
    payload: MFSendPayload
  ): Promise<MFSendResult> {
    const departmentId = await this.findOrCreateDepartment(partnerId, payload.partnerName);

    // MF's API cannot accept an external file upload on a billing — the
    // billing PDF it returns is generated by MF itself from these fields.
    // Reference the original submitter file by name so AP staff can match
    // this billing back to the source document.
    const memo = [payload.memo, payload.pdfFilename ? `Source PDF: ${payload.pdfFilename}` : null]
      .filter(Boolean)
      .join(" / ");

    const body = {
      department_id: departmentId,
      title:        payload.title,
      billing_date: payload.billingDate,
      due_date:     payload.dueDate ?? null,
      memo,
      items: [
        {
          name:     payload.title,
          quantity: 1,
          price:    payload.amount,
          excise:   "untaxable",
        },
      ],
    };

    const res = await this.apiFetch<Record<string, unknown>>(`POST`, `/invoice_template_billings`, body);
    console.log("[MF] POST /invoice_template_billings response:", JSON.stringify(res).slice(0, 400));

    const record = res as { id?: string };
    const id = String(record.id ?? "");
    // record.pdf_url points at the API's own PDF endpoint, which requires an
    // OAuth Bearer token — it 401s ("token_missing") when opened directly in
    // a browser. The MF web app URL below is what users can actually click
    // through to (requires being logged into MF in that browser session).
    const url = `https://invoice.moneyforward.com/billings/${id}`;

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
