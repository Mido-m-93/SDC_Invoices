"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useLanguage, type TranslationKey } from "@/translations";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import {
  SHOW_SEND_TO_MF,
  SHOW_CREATE_MF_PAYEE,
  SHOW_EXPENSES_UPLOAD_EXCEL,
  SHOW_EXPENSES_NEW_CLAIM,
  SHOW_DASHBOARD_NO_DATA_BANNER,
  SHOW_MF_SANDBOX_TEST,
} from "@/lib/featureFlags";

const FEATURE_FLAGS: Array<[string, boolean]> = [
  ["SHOW_SEND_TO_MF", SHOW_SEND_TO_MF],
  ["SHOW_CREATE_MF_PAYEE", SHOW_CREATE_MF_PAYEE],
  ["SHOW_EXPENSES_UPLOAD_EXCEL", SHOW_EXPENSES_UPLOAD_EXCEL],
  ["SHOW_EXPENSES_NEW_CLAIM", SHOW_EXPENSES_NEW_CLAIM],
  ["SHOW_DASHBOARD_NO_DATA_BANNER", SHOW_DASHBOARD_NO_DATA_BANNER],
  ["SHOW_MF_SANDBOX_TEST", SHOW_MF_SANDBOX_TEST],
];

interface Tool {
  key: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  buttonKey: TranslationKey;
  run: () => Promise<unknown>;
  /** True for anything that isn't a read-only check — confirm before running. */
  sideEffecting?: boolean;
}

export default function AdminPage() {
  const { t } = useLanguage();
  const { isAdmin, ready } = useCurrentUser();
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; data: unknown }>>({});

  useEffect(() => {
    if (ready && !isAdmin) router.replace("/dashboard");
  }, [ready, isAdmin, router]);

  async function runTool(tool: Tool) {
    if (tool.sideEffecting && !confirm(t("admin_confirm_run"))) return;
    setRunning(tool.key);
    try {
      const data = await tool.run();
      setResults((prev) => ({ ...prev, [tool.key]: { ok: true, data } }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [tool.key]: { ok: false, data: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setRunning(null);
    }
  }

  async function callJson(url: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
    return data;
  }

  const tools: Tool[] = [
    {
      key: "drive",
      titleKey: "admin_tool_drive_title",
      descKey: "admin_tool_drive_desc",
      buttonKey: "admin_tool_drive_button",
      run: () => callJson("/api/debug/drive"),
    },
    {
      key: "sharepoint_pipeline",
      titleKey: "admin_tool_sharepoint_pipeline_title",
      descKey: "admin_tool_sharepoint_desc",
      buttonKey: "admin_tool_sharepoint_pipeline_button",
      run: () => callJson("/api/debug/sharepoint-folder?which=pipeline"),
    },
    {
      key: "sharepoint_contracts",
      titleKey: "admin_tool_sharepoint_contracts_title",
      descKey: "admin_tool_sharepoint_desc",
      buttonKey: "admin_tool_sharepoint_contracts_button",
      run: () => callJson("/api/debug/sharepoint-folder?which=contracts"),
    },
    {
      key: "sync_expenses",
      titleKey: "admin_tool_sync_expenses_title",
      descKey: "admin_tool_sync_expenses_desc",
      buttonKey: "admin_tool_sync_expenses_button",
      run: () => callJson("/api/expenses/sync-forms", { method: "POST" }),
      sideEffecting: true,
    },
    {
      key: "escalation",
      titleKey: "admin_tool_escalation_title",
      descKey: "admin_tool_escalation_desc",
      buttonKey: "admin_tool_escalation_button",
      run: () => callJson("/api/escalation", { method: "POST" }),
      sideEffecting: true,
    },
    {
      key: "import_vendors",
      titleKey: "admin_tool_import_vendors_title",
      descKey: "admin_tool_import_vendors_desc",
      buttonKey: "admin_tool_import_vendors_button",
      run: () => callJson("/api/admin/import-vendors", { method: "POST" }),
      sideEffecting: true,
    },
  ];

  if (!ready || !isAdmin) return null;

  return (
    <>
      <PageHeader title={t("admin_title")} subtitle={t("admin_subtitle")} />

      <div className="grid gap-4 md:grid-cols-2">
        {tools.map((tool) => {
          const result = results[tool.key];
          return (
            <div key={tool.key} className="bg-white rounded-xl border border-stone-200 p-5 flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-stone-800">{t(tool.titleKey)}</h3>
                <p className="text-xs text-stone-500 mt-0.5">{t(tool.descKey)}</p>
              </div>
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={running === tool.key}
                  onClick={() => runTool(tool)}
                >
                  {t(tool.buttonKey)}
                </Button>
              </div>
              {result && (
                <pre
                  className={`text-xs rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap ${
                    result.ok ? "bg-stone-50 text-stone-700" : "bg-red-50 text-red-700"
                  }`}
                >
                  {typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2)}
                </pre>
              )}
            </div>
          );
        })}

        <div className="bg-white rounded-xl border border-stone-200 p-5 flex flex-col gap-3 md:col-span-2">
          <div>
            <h3 className="text-sm font-semibold text-stone-800">{t("admin_flags_title")}</h3>
            <p className="text-xs text-stone-500 mt-0.5">{t("admin_flags_desc")}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {FEATURE_FLAGS.map(([name, value]) => (
              <div key={name} className="flex items-center justify-between rounded-lg border border-stone-100 px-3 py-2">
                <span className="font-mono text-stone-600">{name}</span>
                <span className={value ? "text-green-600 font-semibold" : "text-stone-400"}>{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
