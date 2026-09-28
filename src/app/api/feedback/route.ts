import { NextRequest, NextResponse } from "next/server";
import { getFeedbackService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth, requireAdmin } from "@/lib/auth-guard";
import type { Feedback } from "@/types";

export const dynamic = 'force-dynamic';

// Admin-only — the submissions list is not something every member should see.
export async function GET() {
  const { user, response } = await requireAdmin();
  if (!user) return response!;
  try {
    const svc = getFeedbackService();
    const feedback = await svc.listFeedback();
    return NextResponse.json({ count: feedback.length, feedback });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Any logged-in member can submit feedback.
export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as { rating?: number; category?: Feedback["category"]; message?: string };
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "rating must be an integer 1-5" }, { status: 400 });
    }

    const feedback: Feedback = {
      id: generateId(),
      // userId/userEmail come from the authenticated session, not the request
      // body — a submitter can't claim to be someone else.
      userId: user.id,
      userEmail: user.email,
      rating,
      category: body.category ?? "other",
      message: body.message?.trim() ?? "",
      createdAt: new Date().toISOString(),
    };
    await getFeedbackService().submitFeedback(feedback);
    return NextResponse.json({ success: true, feedback });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
