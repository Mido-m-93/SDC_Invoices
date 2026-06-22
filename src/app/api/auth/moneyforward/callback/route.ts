// GET /api/auth/moneyforward/callback — exchange authorization code for tokens
import { NextRequest, NextResponse } from "next/server";
import { exchangeMFCode } from "@/lib/services/real/MoneyForwardService";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return new NextResponse(
      html(`<h2>Authorization denied</h2><p>${error}</p>`),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  if (!code) {
    return new NextResponse(
      html(`<h2>Missing code</h2><p>No authorization code in the callback URL.</p>`),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  try {
    const tokens = await exchangeMFCode(code);

    return new NextResponse(
      html(`
        <h2>Money Forward connected!</h2>
        <p>Copy these values into your <code>.env.local</code> and restart the dev server.</p>
        <table>
          <tr>
            <td><code>MF_ACCESS_TOKEN</code></td>
            <td><textarea rows="2" style="width:600px">${tokens.accessToken}</textarea></td>
          </tr>
          <tr>
            <td><code>MF_REFRESH_TOKEN</code></td>
            <td><textarea rows="2" style="width:600px">${tokens.refreshToken}</textarea></td>
          </tr>
        </table>
        <p style="color:#888">Access token expires in ${Math.round(tokens.expiresIn / 60)} minutes. The app will try to refresh it automatically using MF_REFRESH_TOKEN.</p>
      `),
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (err) {
    return new NextResponse(
      html(`<h2>Token exchange failed</h2><pre>${String(err)}</pre>`),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

function html(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Money Forward Auth</title>
  <style>body{font-family:monospace;padding:2rem;max-width:900px;margin:auto}
  table{border-collapse:collapse;width:100%}td{padding:8px;vertical-align:top}
  textarea{font-family:monospace;font-size:12px;background:#f5f5f5;border:1px solid #ccc;padding:4px}
  h2{color:#1a1a1a}</style></head><body>${body}</body></html>`;
}
