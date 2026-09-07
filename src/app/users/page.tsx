"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { useLanguage } from "@/translations";
import { formatTimestamp } from "@/lib/utils";

interface AppUser {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
}

export default function UsersPage() {
  const { t, language } = useLanguage();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.status === 401) { window.location.href = "/login"; return; }
      const data = await res.json() as { users?: AppUser[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUsers(data.users ?? []);
    } catch (e) {
      setError(t("users_error_load").replace("{message}", e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  return (
    <AppShell>
      <PageHeader title={t("users_title")} subtitle={t("users_subtitle")} />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">{t("users_loading")}</p>
      ) : users.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("users_empty_title")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">{t("users_col_email")}</th>
                <th className="px-4 py-3 text-left">{t("users_col_created")}</th>
                <th className="px-4 py-3 text-left">{t("users_col_last_sign_in")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">{u.email || "—"}</td>
                  <td className="px-4 py-3 text-stone-500">{formatTimestamp(u.createdAt, language)}</td>
                  <td className="px-4 py-3 text-stone-500">
                    {u.lastSignInAt ? formatTimestamp(u.lastSignInAt, language) : t("users_last_sign_in_never")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
