"use client";

import { useState } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

export default function SettingsPage() {
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
      setUsernameError("Username must be at least 2 characters.");
      return;
    }
    setUsernameLoading(true);
    setUsernameError(null);
    setUsernameSuccess(null);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ data: { username: slug } });
    if (updateError) {
      setUsernameError(updateError.message);
    } else {
      setUsernameSuccess(`Username updated to "${slug}". Sign out and back in to see it in the sidebar.`);
      setUsername("");
    }
    setUsernameLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);

    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess("Password updated successfully.");
      setPassword("");
      setConfirm("");
    }
    setLoading(false);
  };

  const inputClass = "w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-[#2d6a4f] focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/20";

  return (
    <AppShell>
      <PageHeader title="Settings" subtitle="Manage your account" />
      <div className="max-w-md space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <h2 className="text-base font-semibold text-stone-900 mb-5">Change username</h2>
          <form onSubmit={handleUsernameSubmit} className="space-y-4">
            {usernameError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{usernameError}</div>
            )}
            {usernameSuccess && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">{usernameSuccess}</div>
            )}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700" htmlFor="username">New username</label>
              <input id="username" type="text" autoComplete="username" required value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass} placeholder="e.g. mido" />
            </div>
            <button type="submit" disabled={usernameLoading}
              className="w-full rounded-xl bg-[#2d6a4f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#235c43] disabled:opacity-60 disabled:cursor-not-allowed">
              {usernameLoading ? "Saving…" : "Update username"}
            </button>
          </form>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <h2 className="text-base font-semibold text-stone-900 mb-5">Change password</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
            )}
            {success && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">{success}</div>
            )}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700" htmlFor="password">New password</label>
              <input id="password" type="password" autoComplete="new-password" required minLength={6}
                value={password} onChange={(e) => setPassword(e.target.value)}
                className={inputClass} placeholder="••••••••" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700" htmlFor="confirm">Confirm password</label>
              <input id="confirm" type="password" autoComplete="new-password" required minLength={6}
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className={inputClass} placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-[#2d6a4f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#235c43] disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
