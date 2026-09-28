"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useLanguage, type TranslationKey } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import type { Feedback, FeedbackCategory } from "@/types";

const CATEGORIES: FeedbackCategory[] = ["bug", "suggestion", "question", "other"];

export default function FeedbackPage() {
  const { t, language } = useLanguage();
  const { notify } = useNotifications();
  const { isAdmin } = useCurrentUser();

  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState<FeedbackCategory>("suggestion");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [submissions, setSubmissions] = useState<Feedback[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  const loadSubmissions = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingList(true);
    try {
      const res = await fetch("/api/feedback");
      const data = await res.json() as { feedback?: Feedback[] };
      setSubmissions(data.feedback ?? []);
    } catch {
      // Silent — the admin list is a bonus view, not critical path.
    } finally {
      setLoadingList(false);
    }
  }, [isAdmin]);

  useEffect(() => { loadSubmissions(); }, [loadSubmissions]);

  async function handleSubmit() {
    if (rating < 1) {
      notify("error", t("feedback_error_rating_required"), "/feedback");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, category, message }),
      });
      if (!res.ok) throw new Error(await res.text());
      setRating(0);
      setCategory("suggestion");
      setMessage("");
      notify("success", t("feedback_thank_you"), "/feedback");
      loadSubmissions();
    } catch {
      notify("error", t("feedback_error_submit"), "/feedback");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("feedback_title")} subtitle={t("feedback_subtitle")} />

      <div className="max-w-xl bg-white rounded-xl border border-stone-200 p-6 space-y-5">
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-2">{t("feedback_field_rating")}</label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-label={`${n}`}
                className={`h-9 w-9 rounded-lg border text-sm font-semibold transition-colors ${
                  rating >= n
                    ? "bg-[#1a3d2b] border-[#1a3d2b] text-white"
                    : "bg-white border-stone-200 text-stone-400 hover:border-stone-300"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-500 mb-2">{t("feedback_field_category")}</label>
          <select
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30"
            value={category}
            onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(`feedback_category_${c}` as TranslationKey)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-500 mb-2">{t("feedback_field_message")}</label>
          <textarea
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 resize-none focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("feedback_field_message_placeholder")}
          />
        </div>

        <Button
          variant="primary"
          loading={submitting}
          onClick={handleSubmit}
          className="bg-[#1a3d2b] hover:bg-[#1a3d2b]/90 text-white"
        >
          {t("feedback_submit")}
        </Button>
      </div>

      {isAdmin && (
        <div className="mt-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-stone-400">
            {t("feedback_admin_list_title")}
          </p>
          {loadingList ? (
            <p className="text-sm text-stone-400">{t("loading")}</p>
          ) : submissions.length === 0 ? (
            <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
              <p className="text-stone-400 text-sm">{t("feedback_admin_list_empty")}</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">{t("feedback_col_submitted_by")}</th>
                    <th className="px-4 py-3 text-left">{t("feedback_col_rating")}</th>
                    <th className="px-4 py-3 text-left">{t("feedback_col_category")}</th>
                    <th className="px-4 py-3 text-left">{t("feedback_col_message")}</th>
                    <th className="px-4 py-3 text-left">{t("feedback_col_submitted_at")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {submissions.map((f) => (
                    <tr key={f.id} className="hover:bg-stone-50 align-top">
                      <td className="px-4 py-3 text-stone-600">{f.userEmail || f.userId}</td>
                      <td className="px-4 py-3 font-semibold text-stone-800">{f.rating} / 5</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                          {t(`feedback_category_${f.category}` as TranslationKey)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-stone-600 max-w-sm whitespace-pre-wrap">{f.message || "—"}</td>
                      <td className="px-4 py-3 text-xs text-stone-400 font-mono whitespace-nowrap">
                        {new Date(f.createdAt).toLocaleString(language === "ja" ? "ja-JP" : "en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
