// POST /api/invoices/force-refresh
// Creates a workbook session to force Microsoft Forms→Excel sync, then closes
// it. Microsoft Forms only flushes new responses into the linked Excel when
// the file is "opened" — this API call replicates that open so new submissions
// appear without the user having to manually view the sheet.
import "server-only";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TENANT_ID     = process.env.AZURE_TENANT_ID!;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;
const OWNER_UPN     = process.env.MICROSOFT_OWNER_UPN!;
const ITEM_ID       = process.env.MICROSOFT_EXCEL_ITEM_ID!;

async function getToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Failed to get Graph token");
  return data.access_token;
}

export async function POST() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const token = await getToken();

    const driveRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${OWNER_UPN}/drive`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    const drive = await driveRes.json() as { id?: string };
    if (!drive.id) return NextResponse.json({ error: "Could not resolve drive" }, { status: 502 });

    const sessionRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${drive.id}/items/${ITEM_ID}/workbook/createSession`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ persistChanges: false }),
        cache: "no-store",
      }
    );

    if (!sessionRes.ok) {
      const err = await sessionRes.text();
      console.warn("[force-refresh] Session creation failed:", sessionRes.status, err);
      return NextResponse.json({ ok: false, note: "Session creation failed — Excel may still sync" });
    }

    const session = await sessionRes.json() as { id?: string };

    // Wait for Forms to flush pending responses into the workbook.
    await new Promise((r) => setTimeout(r, 2500));

    // Close the session — fire and forget.
    if (session.id) {
      fetch(
        `https://graph.microsoft.com/v1.0/drives/${drive.id}/items/${ITEM_ID}/workbook/sessions/${session.id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "workbook-session-id": session.id } }
      ).catch(() => { /* ignore */ });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[force-refresh]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
