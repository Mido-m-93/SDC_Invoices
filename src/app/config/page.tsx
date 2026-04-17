"use client";
// src/app/config/page.tsx

import { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useLanguage } from "@/translations";
import { fetchConfig, saveConfig } from "@/lib/api/client";
import type { AppConfig } from "@/types";
import { DEFAULT_CONFIG } from "@/config/defaults";

export default function ConfigPage() {
  const { t } = useLanguage();
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchConfig()
      .then(setConfig)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveConfig(config);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const setStringArray = (key: "completedStatuses" | "skipStatuses", raw: string) =>
    set(key, raw.split("\n").map((s) => s.trim()).filter(Boolean));

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64 text-stone-400 text-sm">{t("loading")}</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="px-8 py-8 max-w-3xl">
        <PageHeader
          title={t("config_title")}
          actions={
            <Button variant="primary" size="md" loading={saving} onClick={handleSave}>
              {savedOk ? "✓ 保存しました" : t("config_save")}
            </Button>
          }
        />

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700 font-mono">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Completed statuses */}
          <Card title={t("config_completed_statuses")}>
            <p className="text-xs text-stone-400 mb-3">
              支払処理 列のこれらの値は「処理済み」として扱います（1行に1つ）
            </p>
            <textarea
              className={textareaClass}
              rows={4}
              value={config.completedStatuses.join("\n")}
              onChange={(e) => setStringArray("completedStatuses", e.target.value)}
              placeholder={"支払済み\n完了\n処理済み"}
            />
          </Card>

          {/* Skip statuses */}
          <Card title={t("config_skip_statuses")}>
            <p className="text-xs text-stone-400 mb-3">
              これらの値を持つ行は処理をスキップします（1行に1つ）
            </p>
            <textarea
              className={textareaClass}
              rows={3}
              value={config.skipStatuses.join("\n")}
              onChange={(e) => setStringArray("skipStatuses", e.target.value)}
              placeholder={"キャンセル\n対象外"}
            />
          </Card>

          {/* Folder naming */}
          <Card title={t("config_folder_naming")}>
            <p className="text-xs text-stone-400 mb-3">
              Google Drive の月別フォルダ名の命名規則
            </p>
            <div className="space-y-2">
              {(["YYYY-MM", "YYYY年MM月", "custom"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="folderMode"
                    value={mode}
                    checked={config.monthFolderNamingMode === mode}
                    onChange={() => set("monthFolderNamingMode", mode)}
                    className="accent-[#2d6a4f]"
                  />
                  <span className="text-sm font-mono text-stone-700">
                    {mode === "YYYY-MM" ? "2024-03" : mode === "YYYY年MM月" ? "2024年03月" : "カスタム"}
                  </span>
                </label>
              ))}
            </div>
            {config.monthFolderNamingMode === "custom" && (
              <div className="mt-3">
                <input
                  type="text"
                  className={inputClass}
                  value={config.monthFolderCustomTemplate}
                  onChange={(e) => set("monthFolderCustomTemplate", e.target.value)}
                  placeholder="{YYYY}年{MM}月"
                />
                <p className="text-xs text-stone-400 mt-1">
                  トークン: {"{YYYY}"} {"{MM}"} {"{closingMonth}"}
                </p>
              </div>
            )}
          </Card>

          {/* Filename rule */}
          <Card title={t("config_filename_rule")}>
            <p className="text-xs text-stone-400 mb-3">
              保存ファイル名のテンプレート（.pdf は自動付与）
            </p>
            <input
              type="text"
              className={inputClass}
              value={config.filenameRule}
              onChange={(e) => set("filenameRule", e.target.value)}
              placeholder="{payerName}_{originalFilename}"
            />
            <p className="text-xs text-stone-400 mt-1">
              トークン: {"{payerName}"} {"{originalFilename}"} {"{closingMonth}"}
            </p>
            <div className="mt-2 text-xs font-mono text-stone-500 bg-stone-50 px-3 py-2 rounded-lg">
              プレビュー:{" "}
              {config.filenameRule
                .replace("{payerName}", "田中 太郎")
                .replace("{originalFilename}", "invoice_march")
                .replace("{closingMonth}", "2024年3月")}
              .pdf
            </div>
          </Card>

          {/* Duplicate detection */}
          <Card title={t("config_duplicate_mode")}>
            <div className="space-y-2">
              {(["none", "filename", "hash"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="dupMode"
                    value={mode}
                    checked={config.duplicateDetectionMode === mode}
                    onChange={() => set("duplicateDetectionMode", mode)}
                    className="accent-[#2d6a4f]"
                  />
                  <span className="text-sm text-stone-700">
                    {mode === "none"
                      ? "なし（常に上書き）"
                      : mode === "filename"
                      ? "ファイル名で検出"
                      : "ハッシュで検出（より正確）"}
                  </span>
                </label>
              ))}
            </div>
          </Card>

          {/* Amount tolerance */}
          <Card title={t("config_amount_tolerance")}>
            <p className="text-xs text-stone-400 mb-3">
              請求書金額とシート金額の許容誤差（通貨単位）
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                className={inputClass + " w-32"}
                value={config.amountToleranceAbsolute}
                onChange={(e) => set("amountToleranceAbsolute", Number(e.target.value))}
              />
              <span className="text-sm text-stone-500">円 / unit</span>
            </div>
          </Card>
        </div>

        <div className="mt-8 pt-6 border-t border-stone-200">
          <Button variant="primary" size="lg" loading={saving} onClick={handleSave}>
            {savedOk ? "✓ 保存しました" : t("config_save")}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5">
      <h3 className="text-sm font-semibold text-stone-800 mb-4">{title}</h3>
      {children}
    </div>
  );
}

const inputClass =
  "w-full text-sm border border-stone-200 rounded-lg px-3 py-2 font-mono text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f] focus:ring-offset-1 bg-white";

const textareaClass =
  "w-full text-sm border border-stone-200 rounded-lg px-3 py-2 font-mono text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f] focus:ring-offset-1 bg-white resize-y";
