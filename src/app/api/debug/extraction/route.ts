import { NextRequest, NextResponse } from "next/server";
import { extractFromPdf } from "@/lib/services/ai/pdfExtractor";
import { downloadSharePointFile } from "@/lib/services/real/SharePointContractService";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const url = req.nextUrl.searchParams.get("url");

  const hasAzure = !!(
    process.env.AZURE_TENANT_ID &&
    process.env.AZURE_CLIENT_ID &&
    process.env.AZURE_CLIENT_SECRET
  );
  const groqKey = process.env.GROQ_API_KEY;

  // Test Groq API
  let groqPing: { ok: boolean; error?: string } = { ok: false };
  if (groqKey) {
    try {
      const Groq = (await import("groq-sdk")).default;
      const client = new Groq({ apiKey: groqKey });
      const res = await client.chat.completions.create({
        model: "openai/gpt-oss-120b",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      });
      groqPing = { ok: !!res.choices[0]?.message?.content };
    } catch (err) {
      groqPing = { ok: false, error: String(err) };
    }
  }

  // Test unpdf import (local PDF text extraction — no Groq call needed)
  let unpdfImport: { ok: boolean; error?: string } = { ok: false };
  try {
    const { getDocumentProxy } = await import("unpdf");
    unpdfImport = { ok: typeof getDocumentProxy === "function" };
  } catch (err) {
    unpdfImport = { ok: false, error: String(err) };
  }

  if (!url) {
    return NextResponse.json({
      status: "config_only",
      groqKeySet: !!groqKey,
      groqKeyPrefix: groqKey ? groqKey.slice(0, 8) + "..." : null,
      groqApiReachable: groqPing,
      unpdfImportOk: unpdfImport,
      azureCredsSet: hasAzure,
    });
  }

  // Step 1: download PDF
  let pdfBytes: Uint8Array;
  let downloadMethod: string;
  try {
    const isSharePoint =
      url.includes("sharepoint.com") ||
      url.includes("1drv.ms") ||
      url.includes("onedrive.live.com");

    if (hasAzure && isSharePoint) {
      pdfBytes = await downloadSharePointFile(url);
      downloadMethod = "sharepoint";
    } else {
      const res = await fetch(url);
      if (!res.ok) {
        return NextResponse.json({ error: `fetch failed: ${res.status} ${res.statusText}` }, { status: 200 });
      }
      pdfBytes = new Uint8Array(await res.arrayBuffer());
      downloadMethod = "direct_fetch";
    }
  } catch (err) {
    return NextResponse.json({ error: `download_failed: ${String(err)}` }, { status: 200 });
  }

  const isPdf =
    pdfBytes.length >= 4 &&
    pdfBytes[0] === 0x25 && pdfBytes[1] === 0x50 &&
    pdfBytes[2] === 0x44 && pdfBytes[3] === 0x46;

  if (!isPdf) {
    return NextResponse.json({
      error: "downloaded_bytes_not_pdf",
      downloadMethod,
      byteLength: pdfBytes.length,
      firstBytes: Array.from(pdfBytes.slice(0, 8)).map(b => b.toString(16)).join(" "),
    }, { status: 200 });
  }

  // Step 2: extract fields
  try {
    const extracted = await extractFromPdf(pdfBytes);
    return NextResponse.json({
      status: "ok",
      downloadMethod,
      byteLength: pdfBytes.length,
      extracted,
    });
  } catch (err) {
    return NextResponse.json({
      status: "extraction_failed",
      downloadMethod,
      byteLength: pdfBytes.length,
      error: String(err),
      errorDetail: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) } : null,
    }, { status: 200 });
  }
}
