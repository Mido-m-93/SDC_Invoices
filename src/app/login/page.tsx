"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { useLanguage } from "@/translations";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const confirmed = searchParams.get("confirmed") === "true";
  const confirmError = searchParams.get("error") === "confirmation_failed";
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetForm = () => {
    setName(""); setEmail(""); setPassword("");
    setError(null); setSuccess(null);
  };

  const switchMode = (next: "signin" | "signup" | "reset") => {
    setMode(next);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const supabase = createSupabaseBrowserClient();
    if (!supabase) { setError(t("login_error_auth_not_configured")); setLoading(false); return; }

    if (mode === "signin") {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authError.message);
        setLoading(false);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } else if (mode === "signup") {
      const { data: signUpData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name: name.trim() } },
      });
      if (authError) {
        setError(authError.message);
        setLoading(false);
      } else if (signUpData.user && signUpData.user.identities?.length === 0) {
        setError(t("login_error_email_already_registered"));
        setLoading(false);
      } else {
        setSuccess(t("login_success_signup_check_email"));
        setLoading(false);
      }
    } else {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      });
      if (authError) {
        setError(authError.message);
      } else {
        setSuccess(t("login_success_reset_email_sent"));
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="w-full max-w-sm">
        {/* Logo / brand */}
        <div className="mb-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2d6a4f] mb-4">
            <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-900">{t("login_app_name")}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {mode === "signin" ? t("login_subtitle_signin") : mode === "signup" ? t("login_subtitle_signup") : t("login_subtitle_reset")}
          </p>
        </div>

        {/* URL-driven banners (after email confirmation redirect) */}
        {confirmed && (
          <div className="mb-4 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
            {t("login_email_confirmed_banner")}
          </div>
        )}
        {confirmError && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {t("login_confirmation_failed_banner")}
          </div>
        )}

        {/* Tab toggle — hidden on reset screen */}
        {mode !== "reset" && (
          <div className="mb-4 flex rounded-xl bg-stone-100 p-1">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                mode === "signin" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              }`}
            >
              {t("login_tab_signin")}
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                mode === "signup" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              }`}
            >
              {t("login_tab_signup")}
            </button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 space-y-5">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              {success}
            </div>
          )}

          {mode === "signup" && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700" htmlFor="name">
                {t("login_name_label")}
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-[#2d6a4f] focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/20"
                placeholder={t("login_name_placeholder")}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-stone-700" htmlFor="email">
              {t("login_email_label")}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-[#2d6a4f] focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/20"
              placeholder={t("login_email_placeholder")}
            />
          </div>

          {mode !== "reset" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-stone-700" htmlFor="password">
                  {t("login_password_label")}
                </label>
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={() => switchMode("reset")}
                    className="text-xs text-[#2d6a4f] hover:underline"
                  >
                    {t("login_forgot_password")}
                  </button>
                )}
              </div>
              <input
                id="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-[#2d6a4f] focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/20"
                placeholder="••••••••"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[#2d6a4f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#235c43] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading
              ? mode === "signin" ? t("login_submit_signin_loading") : mode === "signup" ? t("login_submit_signup_loading") : t("login_submit_reset_loading")
              : mode === "signin" ? t("login_submit_signin") : mode === "signup" ? t("login_submit_signup") : t("login_submit_reset")}
          </button>

          {mode === "reset" && (
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="w-full text-center text-sm text-stone-500 hover:text-stone-700"
            >
              {t("login_back_to_signin")}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
