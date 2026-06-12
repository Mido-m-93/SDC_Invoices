"use client";

import { useState } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

export default function SettingsPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      <div className="max-w-md">
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
