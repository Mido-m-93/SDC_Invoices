"use client";

import { useState } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { useLanguage } from "@/translations";

export default function SettingsPage() {
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (slug.length < 2) {
      setUsernameError(t("account_settings_username_error_min_length"));
      return;
    }
    setUsernameLoading(true);
    setUsernameError(null);
    setUsernameSuccess(null);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) { setUsernameError(t("account_settings_auth_not_configured")); setUsernameLoading(false); return; }
    const { error: updateError } = await supabase.auth.updateUser({ data: { username: slug } });
    if (updateError) {
      setUsernameError(updateError.message);
    } else {
      setUsernameSuccess(t("account_settings_username_success", { slug }));
      setUsername("");
    }
    setUsernameLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(t("account_settings_password_mismatch"));
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);

    const supabase = createSupabaseBrowserClient();
    if (!supabase) { setError(t("account_settings_auth_not_configured")); setLoading(false); return; }
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(t("account_settings_password_success"));
      setPassword("");
      setConfirm("");
    }
    setLoading(false);
  };

  const inputClass = "w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-[#2d6a4f] focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/20";

  return (
    <AppShell>
      <PageHeader title={t("account_settings_title")} subtitle={t("account_settings_subtitle")} />
      <div className="max-w-md space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <h2 className="text-base font-semibold text-stone-900 mb-5">{t("account_settings_username_heading")}</h2>
          <form onSubmit={handleUsernameSubmit} className="space-y-4">
            {usernameError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{usernameError}</div>
            )}
            {usernameSuccess && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">{usernameSuccess}</div>
            )}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700" htmlFor="username">{t("account_settings_username_label")}</label>
              <input id="username" type="text" autoComplete="username" required value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass} placeholder={t("account_settings_username_placeholder")} />
            </div>
            <button type="submit" disabled={usernameLoading}
              className="w-full rounded-xl bg-[#2d6a4f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#235c43] disabled:opacity-60 disabled:cursor-not-allowed">
              {usernameLoading ? t("account_settings_username_saving") : t("account_settings_username_submit")}
            </button>
          </form>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <h2 className="text-base font-semibold text-stone-900 mb-5">{t("account_settings_password_heading")}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
            )}
            {success && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">{success}</div>
            )}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700" htmlFor="password">{t("account_settings_password_label")}</label>
              <input id="password" type="password" autoComplete="new-password" required minLength={6}
                value={password} onChange={(e) => setPassword(e.target.value)}
                className={inputClass} placeholder="••••••••" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700" htmlFor="confirm">{t("account_settings_confirm_password_label")}</label>
              <input id="confirm" type="password" autoComplete="new-password" required minLength={6}
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className={inputClass} placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-[#2d6a4f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#235c43] disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? t("account_settings_password_updating") : t("account_settings_password_submit")}
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
