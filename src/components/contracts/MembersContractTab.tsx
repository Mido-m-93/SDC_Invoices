"use client";

import { useState, useEffect } from "react";
import Button from "@/components/ui/Button";
import RefreshIcon from "@/components/ui/RefreshIcon";
import { useLanguage } from "@/translations";
import { useNotifications } from "@/lib/notifications";

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

// Read-only: scans SharePoint's 03_Member contract folder and shows what's
// there. No database writes, no matching — just sync (rescan) and display.
export default function MembersContractTab() {
  const { t } = useLanguage();
  const { notify } = useNotifications();
  const [members, setMembers] = useState<MemberFolder[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function loadMembers(notifyResult: boolean) {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/contracts/member-folders", { method: "POST" });
      const data = await res.json() as { members?: MemberFolder[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? t("members_contract_sync_failed"));
        if (notifyResult) notify("error", data.error ?? t("members_contract_sync_failed"), "/contracts");
        return;
      }
      setMembers(data.members ?? []);
      if (notifyResult) notify("success", t("members_contract_sync_result").replace("{count}", String(data.members?.length ?? 0)), "/contracts");
    } catch {
      setError(t("members_contract_sync_failed"));
      if (notifyResult) notify("error", t("members_contract_sync_failed"), "/contracts");
    } finally {
      setSyncing(false);
    }
  }

  // Auto-load on mount so the folder listing is there without a manual sync;
  // the button below still lets the user rescan for changes.
  useEffect(() => {
    loadMembers(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = search.trim().toLowerCase();
  const filteredMembers = query
    ? (members ?? []).filter((m) => m.name.toLowerCase().includes(query))
    : members;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-stone-500">{t("members_contract_subtitle")}</p>
        <Button variant="secondary" loading={syncing} onClick={() => loadMembers(true)} icon={<RefreshIcon />}>{t("members_contract_sync_button")}</Button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {members !== null && members.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <input
            className="w-full max-w-xs rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/20"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("members_contract_search_placeholder")}
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-xs text-stone-400 hover:text-stone-600">
              {t("clear")}
            </button>
          )}
          <span className="text-xs text-stone-400">
            {filteredMembers?.length ?? 0} / {members.length}
          </span>
        </div>
      )}

      {members === null ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{syncing ? t("loading") : t("members_contract_empty_title")}</p>
        </div>
      ) : members.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("members_contract_no_results")}</p>
        </div>
      ) : filteredMembers?.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("members_contract_no_search_matches")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMembers?.map((m) => (
            <div key={m.name} className="bg-white rounded-xl border border-stone-200 p-4">
              <div className="font-medium text-stone-800 mb-2">
                {m.webUrl ? (
                  <a href={m.webUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{m.name}</a>
                ) : m.name}
              </div>
              {m.files.length === 0 ? (
                <p className="text-xs text-stone-400">{t("members_contract_no_files")}</p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {m.files.map((f) => (
                    <li key={f.name} className="py-1.5 flex items-center justify-between text-sm">
                      {f.webUrl ? (
                        <a href={f.webUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate">
                          {f.isFolder ? "📁 " : "📄 "}{f.name}
                        </a>
                      ) : (
                        <span className="text-stone-700 truncate">{f.isFolder ? "📁 " : "📄 "}{f.name}</span>
                      )}
                      {!f.isFolder && f.size != null && (
                        <span className="text-xs text-stone-400 shrink-0 ml-3">{Math.round(f.size / 1024)} KB</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
