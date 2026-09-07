"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useLanguage } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { formatTimestamp } from "@/lib/utils";

interface AppUser {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  isAdmin: boolean;
}

export default function UsersPage() {
  const { t, language } = useLanguage();
  const { notify } = useNotifications();
  const { userId, isAdmin, ready } = useCurrentUser();
  const router = useRouter();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [roleChangingId, setRoleChangingId] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !isAdmin) router.replace("/dashboard");
  }, [ready, isAdmin, router]);

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

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  async function handleInvite() {
    setInviting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to invite user");
      notify("success", `Invited ${inviteEmail}`, "/users");
      setShowInvite(false);
      setInviteEmail("");
      load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      notify("error", `Failed to invite ${inviteEmail}: ${message}`, "/users");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(u: AppUser) {
    if (!confirm(t("users_remove_confirm").replace("{email}", u.email))) return;
    setRemovingId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to remove user");
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      notify("success", `Removed ${u.email} — moved to Archives`, "/users");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      notify("error", `Failed to remove ${u.email}: ${message}`, "/users");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleSetRole(u: AppUser, makeAdmin: boolean) {
    setRoleChangingId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}/set-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: makeAdmin ? "admin" : "member" }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to update role");
      setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, isAdmin: makeAdmin } : x));
      notify("success", `${makeAdmin ? "Promoted" : "Demoted"} ${u.email}`, "/users");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      notify("error", `Failed to update role for ${u.email}: ${message}`, "/users");
    } finally {
      setRoleChangingId(null);
    }
  }

  if (!ready || !isAdmin) return null;

  return (
    <AppShell>
      <PageHeader
        title={t("users_title")}
        subtitle={t("users_subtitle")}
        actions={
          <Button
            variant="primary"
            onClick={() => setShowInvite(true)}
            className="bg-[#1a3d2b] hover:bg-[#1a3d2b]/90 text-white"
          >
            {t("users_add_button")}
          </Button>
        }
      />

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
                <th className="px-4 py-3 text-left">{t("users_col_role")}</th>
                <th className="px-4 py-3 text-left">{t("users_col_created")}</th>
                <th className="px-4 py-3 text-left">{t("users_col_last_sign_in")}</th>
                <th className="px-4 py-3 text-left">{t("users_col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {users.map((u) => {
                const isSelf = u.id === userId;
                return (
                  <tr key={u.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 font-medium text-stone-800">
                      {u.email || "—"}
                      {isSelf && <span className="ml-2 text-xs text-stone-400">({t("users_you")})</span>}
                    </td>
                    <td className="px-4 py-3">
                      {u.isAdmin ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">
                          {t("users_role_admin")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-stone-100 text-stone-600">
                          {t("users_role_member")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-500">{formatTimestamp(u.createdAt, language)}</td>
                    <td className="px-4 py-3 text-stone-500">
                      {u.lastSignInAt ? formatTimestamp(u.lastSignInAt, language) : t("users_last_sign_in_never")}
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={roleChangingId === u.id}
                        disabled={isSelf && u.isAdmin}
                        title={isSelf && u.isAdmin ? t("users_cant_demote_self") : undefined}
                        onClick={() => handleSetRole(u, !u.isAdmin)}
                      >
                        {u.isAdmin ? t("users_action_revoke_admin") : t("users_action_make_admin")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={removingId === u.id}
                        disabled={isSelf}
                        title={isSelf ? t("users_cant_remove_self") : undefined}
                        onClick={() => handleRemove(u)}
                      >
                        {t("users_action_remove")}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{t("users_invite_modal_title")}</h2>
              <button onClick={() => setShowInvite(false)} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">{t("users_invite_email_label")}</label>
                <input
                  type="email"
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/30"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowInvite(false)}>{t("cancel")}</Button>
              <Button
                variant="primary"
                loading={inviting}
                disabled={!inviteEmail.includes("@")}
                onClick={handleInvite}
                className="bg-[#1a3d2b] hover:bg-[#1a3d2b]/90 text-white"
              >
                {t("users_invite_send")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
