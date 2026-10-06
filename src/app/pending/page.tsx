"use client";

// Shown to new accounts until an admin approves them. Middleware keeps
// pending users here and sends approved users on to the dashboard.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { useLanguage } from "@/translations";

export default function PendingPage() {
  const router = useRouter();
  const { t } = useLanguage();

  // Let admins know someone is waiting (the server emails each sign-up once).
  useEffect(() => { fetch("/api/auth/signup-notify", { method: "POST" }).catch(() => {}); }, []);

  const signOut = async () => {
    await createSupabaseBrowserClient()?.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 mb-4">
          <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-stone-900">{t("pending_title")}</h1>
        <p className="mt-2 text-sm text-stone-500">{t("pending_body")}</p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={() => router.refresh()}
            className="w-full rounded-xl bg-[#2d6a4f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#245a42] transition-colors"
          >
            {t("pending_check_again")}
          </button>
          <button onClick={signOut} className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-stone-500 hover:bg-stone-100 transition-colors">
            {t("pending_sign_out")}
          </button>
        </div>
      </div>
    </div>
  );
}
