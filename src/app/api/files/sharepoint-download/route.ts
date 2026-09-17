// GET /api/files/sharepoint-download?url=<encoded SharePoint URL>&filename=<name>
// Proxies a SharePoint/OneDrive file through Graph and streams it back with
// Content-Disposition: attachment, so a plain <a href> triggers a real
// browser download instead of opening the SharePoint viewer. Used by the
// "Download PDF" buttons on the invoice and expense validation panels for
// the file the submitter actually uploaded (invoiceAttachment / receiptUrl).
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { downloadSharePointFile } from "@/lib/services/real/SharePointContractService";

export const dynamic = "force-dynamic";

function sniffContentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) return "application/msword";
  return "image/jpeg";
}

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const url = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") || "download";
  if (!url) return NextResponse.json({ error: "?url= is required" }, { status: 400 });

  try {
    const bytes = await downloadSharePointFile(url);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": sniffContentType(filename),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (err) {
    console.error("[files/sharepoint-download]", err);
    return NextResponse.json({ error: "Failed to download file" }, { status: 502 });
  }
}
