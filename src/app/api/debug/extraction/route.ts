import { NextRequest, NextResponse } from "next/server";
import { extractFromPdf } from "@/lib/services/ai/pdfExtractor";
import { downloadSharePointFile } from "@/lib/services/real/SharePointContractService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  const hasAzure = !!(
    process.env.AZURE_TENANT_ID &&
    process.env.AZURE_CLIENT_ID &&
    process.env.AZURE_CLIENT_SECRET
  );
  const hasGoogleDocAI = !!(
    process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID &&
    process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID
  );
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Test OpenAI API
  let openaiPing: { ok: boolean; error?: string } = { ok: false };
  if (openaiKey) {
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: openaiKey });
      const res = await client.responses.create({
        model: "gpt-4o-mini",
        input: "Hi",
        max_output_tokens: 5,
      });
      openaiPing = { ok: !!res.output_text };
    } catch (err) {
      openaiPing = { ok: false, error: String(err) };
    }
  }

  // Test Groq API
  let groqPing: { ok: boolean; error?: string } = { ok: false };
  if (groqKey) {
    try {
      const Groq = (await import("groq-sdk")).default;
      const client = new Groq({ apiKey: groqKey });
      const res = await client.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      });
      groqPing = { ok: !!res.choices[0]?.message?.content };
    } catch (err) {
      groqPing = { ok: false, error: String(err) };
    }
  }

  // Test pdfjs-dist import
  let pdfjsImport: { ok: boolean; error?: string } = { ok: false };
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjsImport = { ok: typeof pdfjsLib.getDocument === "function" };
  } catch (err) {
    pdfjsImport = { ok: false, error: String(err) };
  }

  const extractionPriority = hasGoogleDocAI ? "google_doc_ai" : openaiKey ? "openai" : groqKey ? "groq" : "none";

  if (!url) {
    return NextResponse.json({
      status: "config_only",
      extractionPriority,
      openaiKeySet: !!openaiKey,
      openaiKeyPrefix: openaiKey ? openaiKey.slice(0, 8) + "..." : null,
      openaiApiReachable: openaiPing,
      groqKeySet: !!groqKey,
      groqKeyPrefix: groqKey ? groqKey.slice(0, 8) + "..." : null,
      groqApiReachable: groqPing,
      pdfjsImportOk: pdfjsImport,
      azureCredsSet: hasAzure,
      googleDocAISet: hasGoogleDocAI,
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
