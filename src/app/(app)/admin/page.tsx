"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useLanguage, type TranslationKey } from "@/translations";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import {
  SHOW_EXPENSES_UPLOAD_EXCEL,
} from "@/lib/featureFlags";

const FEATURE_FLAGS: Array<[string, boolean]> = [
  ["SHOW_EXPENSES_UPLOAD_EXCEL", SHOW_EXPENSES_UPLOAD_EXCEL],
];

type Status = "ok" | "warn" | "fail" | null;
interface ToolResult { ok: boolean; data: unknown; checkedAt: string }

interface Tool {
  key: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  buttonKey: TranslationKey;
  run: () => Promise<unknown>;
  /** True for anything that isn't a read-only check — confirm before running. */
  sideEffecting?: boolean;
}

// Model pings return { ok, model, error? } — read the model id back from the
// response instead of hardcoding it a second time here, so this label can
// never drift from what production actually calls.
interface ModelPing { ok: boolean; model?: string; error?: string }
interface AiHealthData {
  groqKeySet?: boolean;
  groqTextModelReachable?: ModelPing;
  groqVisionModelReachable?: ModelPing;
}
interface DriveHealthData {
  writeTest?: { ok: boolean };
}

function deriveStatus(key: string, result?: ToolResult): Status {
  if (!result) return null;
  if (!result.ok) return "fail";

  if (key === "ai_health") {
    const data = result.data as AiHealthData;
    if (!data.groqKeySet) return "fail";
    const textOk = !!data.groqTextModelReachable?.ok;
    const visionOk = !!data.groqVisionModelReachable?.ok;
    if (textOk && visionOk) return "ok";
    if (textOk || visionOk) return "warn";
    return "fail";
  }

  if (key === "drive") {
    const data = result.data as DriveHealthData;
    return data.writeTest?.ok ? "ok" : "fail";
  }

  return "ok";
}

const STATUS_STYLE: Record<Exclude<Status, null>, { dot: string; chip: string; labelKey: TranslationKey }> = {
  ok:   { dot: "bg-emerald-500", chip: "bg-emerald-50 border-emerald-200 text-emerald-700", labelKey: "admin_status_ok" },
  warn: { dot: "bg-amber-500",   chip: "bg-amber-50 border-amber-200 text-amber-700",       labelKey: "admin_status_warn" },
  fail: { dot: "bg-red-500",     chip: "bg-red-50 border-red-200 text-red-700",             labelKey: "admin_status_fail" },
};

function StatusBadge({ status, t }: { status: Status; t: (k: TranslationKey) => string }) {
  if (!status) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-medium text-stone-400">
        <span className="h-1.5 w-1.5 rounded-full bg-stone-300" />
        {t("admin_status_not_run")}
      </span>
    );
  }
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {t(s.labelKey)}
    </span>
  );
}

function ModelChip({ label, ping }: { label: string; ping?: ModelPing }) {
  if (!ping?.model) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-[11px] text-stone-600">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ping.ok ? "bg-emerald-500" : "bg-red-500"}`} />
      <span className="text-stone-400">{label}</span>
      <span className="font-mono">{ping.model}</span>
    </span>
  );
}

export default function AdminPage() {
  const { t, language } = useLanguage();
  const { isAdmin, ready } = useCurrentUser();
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ToolResult>>({});

  useEffect(() => {
    if (ready && !isAdmin) router.replace("/dashboard");
  }, [ready, isAdmin, router]);

  async function runTool(tool: Tool) {
    if (tool.sideEffecting && !confirm(t("admin_confirm_run"))) return;
    setRunning(tool.key);
    try {
      const data = await tool.run();
      setResults((prev) => ({ ...prev, [tool.key]: { ok: true, data, checkedAt: new Date().toISOString() } }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [tool.key]: { ok: false, data: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString() } }));
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
      key: "ai_health",
      titleKey: "admin_tool_ai_health_title",
      descKey: "admin_tool_ai_health_desc",
      buttonKey: "admin_tool_ai_health_button",
      run: () => callJson("/api/debug/extraction"),
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
          const status = deriveStatus(tool.key, result);
          const aiData = tool.key === "ai_health" ? (result?.data as AiHealthData | undefined) : undefined;

          return (
            <div key={tool.key} className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-stone-800">{t(tool.titleKey)}</h3>
                  <p className="mt-0.5 text-xs text-stone-500">{t(tool.descKey)}</p>
                </div>
                <StatusBadge status={status} t={t} />
              </div>

              {aiData && (aiData.groqTextModelReachable?.model || aiData.groqVisionModelReachable?.model) && (
                <div className="flex flex-wrap gap-1.5">
                  <ModelChip label={t("admin_model_text")} ping={aiData.groqTextModelReachable} />
                  <ModelChip label={t("admin_model_vision")} ping={aiData.groqVisionModelReachable} />
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={running === tool.key}
                  onClick={() => runTool(tool)}
                >
                  {t(tool.buttonKey)}
                </Button>
                {result && (
                  <span className="text-[11px] text-stone-400">
                    {t("admin_last_checked")} {new Date(result.checkedAt).toLocaleString(language === "ja" ? "ja-JP" : "en-US")}
                  </span>
                )}
              </div>

              {result && (
                <details className="group">
                  <summary className="cursor-pointer select-none text-xs font-medium text-stone-500 hover:text-stone-700">
                    {t("admin_view_raw")}
                  </summary>
                  <pre
                    className={`mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs ${
                      result.ok ? "bg-stone-50 text-stone-700" : "bg-red-50 text-red-700"
                    }`}
                  >
                    {typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          );
        })}

        <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-5 shadow-sm md:col-span-2">
          <div>
            <h3 className="text-sm font-semibold text-stone-800">{t("admin_flags_title")}</h3>
            <p className="mt-0.5 text-xs text-stone-500">{t("admin_flags_desc")}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_FLAGS.map(([name, value]) => (
              <div key={name} className="flex items-center justify-between gap-3 rounded-lg border border-stone-100 px-3 py-2">
                <span className="min-w-0 break-all font-mono text-stone-600">{name}</span>
                <span className={`shrink-0 ${value ? "font-semibold text-emerald-600" : "text-stone-400"}`}>{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
