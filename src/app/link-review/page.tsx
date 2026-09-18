"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useNotifications } from "@/lib/notifications";

interface ReviewRow {
  type: "contract" | "proposal" | "budget";
  id: string;
  name: string;
  clientName: string | null;
  bestMatch: { name: string; score: number; webUrl: string | null; isFolder: boolean } | null;
}

const TYPE_LABEL: Record<ReviewRow["type"], string> = {
  contract: "Contract",
  proposal: "Proposal",
  budget: "Budget",
};

const TYPE_PAGE: Record<ReviewRow["type"], string> = {
  contract: "/contracts",
  proposal: "/proposals",
  budget: "/budget",
};

export default function LinkReviewPage() {
  const { notify } = useNotifications();
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/link-review");
      const data = await res.json() as { rows?: ReviewRow[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to load unlinked records");
        return;
      }
      setRows(data.rows ?? []);
    } catch {
      setError("Failed to load unlinked records");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleLink(row: ReviewRow) {
    if (!row.bestMatch?.webUrl) return;
    const key = `${row.type}:${row.id}`;
    setLinkingKey(key);
    try {
      const res = await fetch("/api/link-review/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: row.type, id: row.id, webUrl: row.bestMatch.webUrl }),
      });
      if (!res.ok) throw new Error();
      notify("success", `Linked ${row.name}`, TYPE_PAGE[row.type]);
      setRows((prev) => (prev ?? []).filter((r) => !(r.type === row.type && r.id === row.id)));
    } catch {
      notify("error", `Failed to link ${row.name}`, TYPE_PAGE[row.type]);
    } finally {
      setLinkingKey(null);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Link Review"
        subtitle="Every contract, proposal, and budget still missing a SharePoint file link — best guess shown per row, nothing is linked without a click"
        actions={<Button variant="secondary" loading={loading} onClick={load}>Refresh</Button>}
      />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {loading && !rows ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : rows && rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">Nothing unlinked — every contract, proposal, and budget has a file.</p>
        </div>
      ) : rows ? (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Client</th>
                <th className="px-4 py-3 text-left">Best match</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => {
                const key = `${r.type}:${r.id}`;
                return (
                  <tr key={key} className="hover:bg-stone-50">
                    <td className="px-4 py-3 text-stone-500">{TYPE_LABEL[r.type]}</td>
                    <td className="px-4 py-3 font-medium text-stone-900">{r.name || "—"}</td>
                    <td className="px-4 py-3 text-stone-600">{r.clientName || "—"}</td>
                    <td className="px-4 py-3">
                      {r.bestMatch ? (
                        <div>
                          <span className="text-stone-700">{r.bestMatch.isFolder ? "📁 " : "📄 "}{r.bestMatch.name}</span>
                          <span className="ml-2 text-xs text-stone-400">{Math.round(r.bestMatch.score * 100)}% match</span>
                        </div>
                      ) : (
                        <span className="text-stone-300">No candidate found</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.bestMatch?.isFolder ? (
                        <a href={TYPE_PAGE[r.type]} className="text-xs text-blue-600 hover:underline">
                          Open in {TYPE_LABEL[r.type]}s to pick a file →
                        </a>
                      ) : r.bestMatch?.webUrl ? (
                        <Button variant="ghost" size="sm" loading={linkingKey === key} onClick={() => handleLink(r)}>
                          Link
                        </Button>
                      ) : (
                        <a href={TYPE_PAGE[r.type]} className="text-xs text-blue-600 hover:underline">
                          Open in {TYPE_LABEL[r.type]}s →
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </AppShell>
  );
}
