import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IFeedbackService } from "../types";
import type { Feedback } from "@/types";

function toRow(f: Feedback): Record<string, unknown> {
  return {
    id: f.id,
    user_id: f.userId,
    user_email: f.userEmail,
    rating: f.rating,
    category: f.category,
    message: f.message,
    created_at: f.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): Feedback {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    userEmail: row.user_email as string,
    rating: row.rating as number,
    category: row.category as Feedback["category"],
    message: row.message as string,
    createdAt: row.created_at as string,
  };
}

export class SupabaseFeedbackService implements IFeedbackService {
  private get db() {
    return getSupabaseClient();
  }

  async listFeedback(): Promise<Feedback[]> {
    const { data, error } = await this.db
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`listFeedback: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async submitFeedback(feedback: Feedback): Promise<void> {
    const { error } = await this.db
      .from("feedback")
      .upsert(toRow(feedback), { onConflict: "id" });
    if (error) throw new Error(`submitFeedback: ${error.message}`);
  }
}
