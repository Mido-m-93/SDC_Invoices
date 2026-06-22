import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";
import { generateId } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { submissionId, comment, commentBy } = body as {
    submissionId?: string;
    comment?: string;
    commentBy?: string;
  };

  if (!submissionId || !comment?.trim()) {
    return NextResponse.json({ error: "Missing submissionId or comment" }, { status: 400 });
  }

  try {
    const storage = getStorageService();
    const [existing] = await storage.loadValidationResults([submissionId]);
    if (!existing) {
      return NextResponse.json({ error: "No validation result found" }, { status: 404 });
    }

    const updated = {
      ...existing,
      reviewerComment: comment.trim(),
      reviewerCommentAt: new Date().toISOString(),
    };
    await storage.saveValidationResult(updated);

    // Audit log entry
    await storage.appendLog({
      id: generateId(),
      runId: "manual",
      submissionId,
      step: "VALIDATION_COMPLETE",
      result: "OK",
      message: `Comment by ${commentBy ?? "reviewer"}: ${comment.trim()}`,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, result: updated });
  } catch (err) {
    console.error("[POST /api/invoices/comment]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
