"use client";

import { useState, useEffect, useCallback } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import RefreshIcon from "@/components/ui/RefreshIcon";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import type { Member, MemberRole, MemberStatus } from "@/types";
import { generateId } from "@/lib/utils";
import { extractMemberName, normaliseMemberName } from "@/lib/memberName";
import { useLanguage, type TranslationKey } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import { useTableControls, byId } from "@/lib/hooks/useTableControls";
import { TableFooter, SelectAllCheckbox, RowCheckbox } from "@/components/ui/TableControls";

interface MemberFolderFile {
  name: string;
  isFolder: boolean;
  size: number | null;
  webUrl: string | null;
}

interface MemberFolder {
  name: string;
  webUrl: string | null;
  files: MemberFolderFile[];
}

const EMPTY_MEMBER: Omit<Member, "id" | "createdAt" | "updatedAt" | "avatarUrl"> = {
  displayName: "",
  email: "",
  phone: "",
  role: "other",
  department: "",
  employeeCode: "",
  joinDate: "",
  status: "active",
  notes: "",
};

const ROLE_COLORS: Record<MemberRole, string> = {
  admin:      "bg-red-100 text-red-700",
  sales:      "bg-blue-100 text-blue-700",
  accounting: "bg-green-100 text-green-700",
  engineer:   "bg-indigo-100 text-indigo-700",
  designer:   "bg-violet-100 text-violet-700",
  manager:    "bg-amber-100 text-amber-700",
  contractor: "bg-teal-100 text-teal-700",
  other:      "bg-stone-100 text-stone-600",
};

const STATUS_TONES: Record<MemberStatus, BadgeTone> = {
  active:   "success",
  inactive: "neutral",
  on_leave: "warning",
};

// Mirrors isContractExpired in lib/contractStats.ts — same "active but the
// end date has already passed" definition, applied to a member's own
// registered contract (contractEnd) instead of the Contract record.
// Compares by calendar day (UTC midnight), not the exact current instant, so
// a contract ending "today" isn't flagged expired hours before the day ends.
function isMemberContractExpired(m: Member, now: Date): boolean {
  if (m.status !== "active" || !m.contractEnd) return false;
  const end = new Date(m.contractEnd).getTime();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return !Number.isNaN(end) && end < todayStart;
}

interface MembersContentProps {
  // Compact mode drops the full PageHeader (title + subtitle) so this can sit
  // inside a tab alongside another header — the action buttons still render.
  compact?: boolean;
}

export default function MembersContent({ compact = false }: MembersContentProps) {
  const { t } = useLanguage();
  const { notify } = useNotifications();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ added: number; skipped: number; total: number } | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_MEMBER });
  const [error, setError] = useState<string | null>(null);
  const [expiredOnly, setExpiredOnly] = useState(false);
  const [folders, setFolders] = useState<MemberFolder[] | null>(null);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [viewingFilesFor, setViewingFilesFor] = useState<Member | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/members");
      if (res.status === 401) { window.location.href = "/login"; return; }
      const data = await res.json() as { members?: Member[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMembers(data.members ?? []);
    } catch (e) {
      setError(t("members_error_load").replace("{message}", e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_MEMBER });
    setShowForm(true);
  }

  function openEdit(m: Member) {
    setEditing(m);
    const { id: _id, createdAt: _c, updatedAt: _u, avatarUrl: _a, ...rest } = m;
    setForm(rest);
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/members/${editing.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          })
        : await fetch("/api/members", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...form, id: generateId("mbr") }),
          });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setShowForm(false);
      notify("success", editing ? `Updated member ${form.displayName}` : `Added member ${form.displayName}`, "/members");
      load();
    } catch (e) {
      setError(t("members_error_save"));
      notify("error", `Failed to save member ${form.displayName}: ${e instanceof Error ? e.message : String(e)}`, "/members");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("members_delete_confirm"))) return;
    const target = members.find((m) => m.id === id);
    try {
      await fetch(`/api/members/${id}`, { method: "DELETE" });
      notify("success", `Deleted member ${target?.displayName ?? id}`, "/members");
      load();
    } catch (e) {
      setError(t("members_error_save"));
      notify("error", `Failed to delete member ${target?.displayName ?? id}: ${e instanceof Error ? e.message : String(e)}`, "/members");
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res = await fetch("/api/members/sync", { method: "POST" });
      const data = await res.json() as { ok: boolean; added: number; skipped: number; total: number; error?: string };
      if (!data.ok) throw new Error(data.error ?? t("members_sync_error_fallback"));
      setSyncResult({ added: data.added, skipped: data.skipped, total: data.total });
      notify("success", `Synced members: ${data.added} added, ${data.skipped} skipped, ${data.total} scanned`, "/members");
      load();
    } catch (e) {
      setError(String(e));
      notify("error", `Failed to sync members: ${e instanceof Error ? e.message : String(e)}`, "/members");
    } finally {
      setSyncing(false);
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Folder listing is a full-tenant scan (see /api/contracts/member-folders),
  // so fetch it once and reuse across every "View Files" click instead of
  // re-scanning SharePoint per member.
  async function ensureFolders(): Promise<MemberFolder[]> {
    if (folders) return folders;
    setLoadingFolders(true);
    setFoldersError(null);
    try {
      const res = await fetch("/api/contracts/member-folders", { method: "POST" });
      const data = await res.json() as { members?: MemberFolder[]; error?: string };
      if (!res.ok) {
        setFoldersError(data.error ?? t("contracts_files_failed"));
        return [];
      }
      const result = data.members ?? [];
      setFolders(result);
      return result;
    } catch {
      setFoldersError(t("contracts_files_failed"));
      return [];
    } finally {
      setLoadingFolders(false);
    }
  }

  function handleViewFiles(m: Member) {
    setViewingFilesFor(m);
    void ensureFolders();
  }

  const matchedFolder = viewingFilesFor
    ? folders?.find((f) => normaliseMemberName(extractMemberName(f.name)) === normaliseMemberName(viewingFilesFor.displayName)) ?? null
    : null;

  const now = new Date();
  const expiredCount = members.filter((m) => isMemberContractExpired(m, now)).length;
  const filteredMembers = expiredOnly ? members.filter((m) => isMemberContractExpired(m, now)) : members;
  const table = useTableControls(filteredMembers, byId, String(expiredOnly));

  const memberActions = (
    <div className="flex items-center gap-2">
      {expiredCount > 0 && (
        <button
          onClick={() => setExpiredOnly((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            expiredOnly ? "bg-red-100 text-red-700" : "bg-stone-100 text-stone-500 hover:bg-stone-200"
          }`}
        >
          ⚠ {t("members_expired_filter").replace("{count}", String(expiredCount))}
        </button>
      )}
      <Button variant="secondary" onClick={handleSync} loading={syncing} icon={<RefreshIcon />}>
        {t("members_sync_button")}
      </Button>
      <Button variant="primary" onClick={openNew}
        className="bg-[#1a3d2b] hover:bg-[#1a3d2b]/90 text-white">
        {t("members_add_button")}
      </Button>
    </div>
  );

  return (
    <div>
      {compact ? (
        <div className="mb-5 flex justify-end">{memberActions}</div>
      ) : (
        <PageHeader title={t("members_title")} subtitle={t("members_subtitle")} actions={memberActions} />
      )}

      {syncResult && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800 flex justify-between items-center">
          <span>
            {t("members_sync_result_main").replace("{added}", String(syncResult.added))}
            {syncResult.skipped > 0 &&
              t("members_sync_result_skipped").replace("{skipped}", String(syncResult.skipped))}
            {t("members_sync_result_scanned").replace("{total}", String(syncResult.total))}
          </span>
          <button onClick={() => setSyncResult(null)} className="text-green-400 hover:text-green-600 ml-4">×</button>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">{t("members_loading")}</p>
      ) : members.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("members_empty_title")}</p>
          <Button variant="primary" className="mt-4 bg-[#1a3d2b] hover:bg-[#1a3d2b]/90 text-white" onClick={openNew}>
            {t("members_empty_add")}
          </Button>
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("members_expired_none")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="pl-4 py-3 w-8"><SelectAllCheckbox controls={table} /></th>
                <th className="px-4 py-3 text-left">{t("members_col_name")}</th>
                <th className="px-4 py-3 text-left">{t("members_col_email")}</th>
                <th className="px-4 py-3 text-left">{t("members_col_role")}</th>
                <th className="px-4 py-3 text-left">{t("members_col_department")}</th>
                <th className="px-4 py-3 text-left">{t("members_col_status")}</th>
                <th className="px-4 py-3 text-left">{t("members_col_join_date")}</th>
                <th className="px-4 py-3 text-left">{t("members_col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {table.rows.map((m) => (
                <tr key={m.id} className="hover:bg-stone-50">
                  <td className="pl-4 py-3 w-8">
                    <RowCheckbox checked={table.isSelected(m)} onChange={() => table.toggle(m)} />
                  </td>
                  <td className="px-4 py-3 font-medium text-stone-800">
                    {m.displayName}
                    {m.employeeCode && (
                      <span className="ml-2 text-xs text-stone-400 font-mono">{m.employeeCode}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-600">{m.email || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[m.role]}`}>
                      {t(`members_role_${m.role}` as TranslationKey)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-500">{m.department || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONES[m.status]}>{t(`members_status_${m.status}` as TranslationKey)}</Badge>
                    {isMemberContractExpired(m, now) && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700" title={m.contractEnd ?? ""}>
                        ⚠ {t("contracts_expired_badge")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-500 font-mono">{m.joinDate || "—"}</td>
                  <td className="px-4 py-3 flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => handleViewFiles(m)}>{t("contracts_action_view_files")}</Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>{t("members_action_edit")}</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(m.id)}>{t("members_action_delete")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TableFooter controls={table} />
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{editing ? t("members_modal_edit_title") : t("members_modal_new_title")}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label={t("members_field_display_name")}>
                <input
                  className={input}
                  value={form.displayName}
                  onChange={(e) => set("displayName", e.target.value)}
                  placeholder={t("members_field_display_name_placeholder")}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("members_field_email")}>
                  <input
                    type="email"
                    className={input}
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder={t("members_field_email_placeholder")}
                  />
                </Field>
                <Field label={t("members_field_phone")}>
                  <input
                    className={input}
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder={t("members_field_phone_placeholder")}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("members_field_role")}>
                  <select
                    className={input}
                    value={form.role}
                    onChange={(e) => set("role", e.target.value as MemberRole)}
                  >
                    <option value="admin">{t("members_role_admin")}</option>
                    <option value="sales">{t("members_role_sales")}</option>
                    <option value="accounting">{t("members_role_accounting")}</option>
                    <option value="engineer">{t("members_role_engineer")}</option>
                    <option value="designer">{t("members_role_designer")}</option>
                    <option value="manager">{t("members_role_manager")}</option>
                    <option value="contractor">{t("members_role_contractor")}</option>
                    <option value="other">{t("members_role_other")}</option>
                  </select>
                </Field>
                <Field label={t("members_field_department")}>
                  <input
                    className={input}
                    value={form.department}
                    onChange={(e) => set("department", e.target.value)}
                    placeholder={t("members_field_department_placeholder")}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("members_field_employee_code")}>
                  <input
                    className={input}
                    value={form.employeeCode}
                    onChange={(e) => set("employeeCode", e.target.value)}
                    placeholder={t("members_field_employee_code_placeholder")}
                  />
                </Field>
                <Field label={t("members_field_join_date")}>
                  <input
                    type="date"
                    className={input}
                    value={form.joinDate}
                    onChange={(e) => set("joinDate", e.target.value)}
                  />
                </Field>
              </div>
              <Field label={t("members_field_status")}>
                <select
                  className={input}
                  value={form.status}
                  onChange={(e) => set("status", e.target.value as MemberStatus)}
                >
                  <option value="active">{t("members_status_active")}</option>
                  <option value="inactive">{t("members_status_inactive")}</option>
                  <option value="on_leave">{t("members_status_on_leave")}</option>
                </select>
              </Field>
              <Field label={t("members_field_notes")}>
                <textarea
                  className={`${input} resize-none`}
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder={t("members_field_notes_placeholder")}
                />
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
              <Button
                variant="primary"
                loading={saving}
                onClick={handleSave}
                className="bg-[#1a3d2b] hover:bg-[#1a3d2b]/90 text-white"
              >
                {t("members_save")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {viewingFilesFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]" onClick={() => setViewingFilesFor(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{viewingFilesFor.displayName}</h2>
              <button onClick={() => setViewingFilesFor(null)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5">
              {loadingFolders && <p className="text-sm text-stone-500">{t("contracts_files_loading")}</p>}
              {foldersError && <p className="text-sm text-red-600">{foldersError}</p>}
              {!loadingFolders && !foldersError && folders && !matchedFolder && (
                <p className="text-sm text-stone-500">{t("members_files_no_match")}</p>
              )}
              {matchedFolder && matchedFolder.files.length === 0 && (
                <p className="text-sm text-stone-500">{t("contracts_files_empty")}</p>
              )}
              {matchedFolder && matchedFolder.files.length > 0 && (
                <ul className="divide-y divide-stone-100">
                  {matchedFolder.files.map((f) => (
                    <li key={f.name} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0 flex-1">
                        {f.webUrl ? (
                          <a href={f.webUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block">
                            {f.isFolder ? "📁 " : "📄 "}{f.name}
                          </a>
                        ) : (
                          <span className="text-stone-700 truncate block">{f.isFolder ? "📁 " : "📄 "}{f.name}</span>
                        )}
                        {!f.isFolder && f.size != null && (
                          <span className="text-xs text-stone-400">{Math.round(f.size / 1024)} KB</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const input = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
