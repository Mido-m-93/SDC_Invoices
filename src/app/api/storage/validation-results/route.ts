// src/app/api/storage/validation-results/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";

export const dynamic = 'force-dynamic';

/**
 * POST /api/storage/validation-results
 * Body: { submissionIds: string[] }
 * Returns stored validation results for the given submission IDs.
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
    const results = await getStorageService().loadValidationResults(submissionIds);
    return NextResponse.json({ count: results.length, results });
  } catch (err) {
    console.error("[POST /api/storage/validation-results]", err);
    return NextResponse.json(
      { error: "Failed to load validation results", detail: String(err) },
      { status: 500 }
    );
  }
}
