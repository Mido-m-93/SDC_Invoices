export const dynamic = "force-dynamic";

// src/app/api/storage/filed-documents/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";

/**
 * POST /api/storage/filed-documents
 * Body: { submissionIds: string[] }
 * Returns filed document records for the given submission IDs.
 */
export async function POST(req: NextRequest) {
  let body: { submissionIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { submissionIds } = body;
  if (!Array.isArray(submissionIds)) {
    return NextResponse.json(
      { error: "Body must include 'submissionIds' array" },
      { status: 400 }
    );
  }

  try {
    const documents = await getStorageService().loadFiledDocuments(submissionIds);
    return NextResponse.json({ count: documents.length, documents });
  } catch (err) {
    console.error("[POST /api/storage/filed-documents]", err);
    return NextResponse.json(
      { error: "Failed to load filed documents", detail: String(err) },
      { status: 500 }
    );
  }
}
