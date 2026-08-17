"use client";
// src/app/config/page.tsx

import { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useLanguage } from "@/translations";
import { fetchConfig, saveConfig, testNotification } from "@/lib/api/client";
import type { AppConfig } from "@/types";
import { DEFAULT_CONFIG } from "@/config/defaults";

export default function ConfigPage() {
  const { t } = useLanguage();
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{ ok: boolean; message: string } | null>(null);

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

  const handleTestWebhook = async () => {
    setTestingWebhook(true);
    setWebhookTestResult(null);
    try {
      // Save current webhook URL first so the API can use it
      await saveConfig(config);
      const result = await testNotification();
      setWebhookTestResult(result);
    } catch (err) {
      setWebhookTestResult({ ok: false, message: String(err) });
    } finally {
      setTestingWebhook(false);
    }
  };

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
              {savedOk ? t("config_saved") : t("config_save")}
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
              {t("config_completed_statuses_help")}
            </p>
            <textarea
              className={textareaClass}
              rows={4}
              value={config.completedStatuses.join("\n")}
              onChange={(e) => setStringArray("completedStatuses", e.target.value)}
              placeholder={t("config_completed_statuses_placeholder")}
            />
          </Card>

          {/* Skip statuses */}
          <Card title={t("config_skip_statuses")}>
            <p className="text-xs text-stone-400 mb-3">
              {t("config_skip_statuses_help")}
            </p>
            <textarea
              className={textareaClass}
              rows={3}
              value={config.skipStatuses.join("\n")}
              onChange={(e) => setStringArray("skipStatuses", e.target.value)}
              placeholder={t("config_skip_statuses_placeholder")}
            />
          </Card>

          {/* Folder naming */}
          <Card title={t("config_folder_naming")}>
            <p className="text-xs text-stone-400 mb-3">
              {t("config_folder_naming_help")}
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
                    {mode === "YYYY-MM" ? "2024-03" : mode === "YYYY年MM月" ? "2024年03月" : t("config_folder_mode_custom")}
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
                  {t("config_tokens_label")} {"{YYYY}"} {"{MM}"} {"{closingMonth}"}
                </p>
              </div>
            )}
          </Card>

          {/* Filename rule */}
          <Card title={t("config_filename_rule")}>
            <p className="text-xs text-stone-400 mb-3">
              {t("config_filename_rule_help")}
            </p>
            <input
              type="text"
              className={inputClass}
              value={config.filenameRule}
              onChange={(e) => set("filenameRule", e.target.value)}
              placeholder="{payerName}_{originalFilename}"
            />
            <p className="text-xs text-stone-400 mt-1">
              {t("config_tokens_label")} {"{payerName}"} {"{originalFilename}"} {"{closingMonth}"}
            </p>
            <div className="mt-2 text-xs font-mono text-stone-500 bg-stone-50 px-3 py-2 rounded-lg">
              {t("config_preview_label")}{" "}
              {config.filenameRule
                .replace("{payerName}", t("config_preview_payer_sample"))
                .replace("{originalFilename}", "invoice_march")
                .replace("{closingMonth}", t("config_preview_month_sample"))}
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
                      ? t("config_dup_mode_none")
                      : mode === "filename"
                      ? t("config_dup_mode_filename")
                      : t("config_dup_mode_hash")}
                  </span>
                </label>
              ))}
            </div>
          </Card>

          {/* Amount tolerance */}
          <Card title={t("config_amount_tolerance")}>
            <p className="text-xs text-stone-400 mb-3">
              {t("config_amount_tolerance_help")}
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                className={inputClass + " w-32"}
                value={config.amountToleranceAbsolute}
                onChange={(e) => set("amountToleranceAbsolute", Number(e.target.value))}
              />
              <span className="text-sm text-stone-500">{t("config_amount_unit")}</span>
            </div>
          </Card>

          {/* ── Phase 7: Notification settings ─────────────────────────────── */}
          <Card title={t("config_notifications_title")}>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1.5">
                  {t("config_teams_webhook")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    className={inputClass + " flex-1"}
                    value={config.teamsWebhookUrl ?? ""}
                    onChange={(e) => set("teamsWebhookUrl", e.target.value)}
                    placeholder={t("config_teams_webhook_placeholder")}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={testingWebhook}
                    onClick={handleTestWebhook}
                  >
                    {t("config_teams_test_send")}
                  </Button>
                </div>
                {webhookTestResult && (
                  <p className={`text-xs mt-1.5 ${webhookTestResult.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {webhookTestResult.ok ? t("config_teams_test_ok") : `${t("config_teams_test_fail")}: ${webhookTestResult.message}`}
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* ── Phase 7: Reminder settings ──────────────────────────────────── */}
          <Card title={t("config_reminder_settings_title")}>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">
                    {t("config_stale_threshold")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      className={inputClass + " w-20"}
                      value={config.staleReviewThresholdDays ?? 3}
                      onChange={(e) => set("staleReviewThresholdDays", Number(e.target.value))}
                    />
                    <span className="text-xs text-stone-400">{t("config_unit_days")}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">
                    {t("config_due_threshold")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      className={inputClass + " w-20"}
                      value={config.dueDateThresholdDays ?? 5}
                      onChange={(e) => set("dueDateThresholdDays", Number(e.target.value))}
                    />
                    <span className="text-xs text-stone-400">{t("config_unit_days_before")}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">
                    {t("config_payment_terms")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      className={inputClass + " w-20"}
                      value={config.paymentTermsDays ?? 30}
                      onChange={(e) => set("paymentTermsDays", Number(e.target.value))}
                    />
                    <span className="text-xs text-stone-400">{t("config_unit_days_after")}</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1.5">
                  {t("config_escalation_recipient")}
                </label>
                <input
                  type="text"
                  className={inputClass}
                  value={config.escalationRecipient ?? ""}
                  onChange={(e) => set("escalationRecipient", e.target.value)}
                  placeholder={t("config_escalation_placeholder")}
                />
              </div>
            </div>
          </Card>
        </div>

        <div className="mt-8 pt-6 border-t border-stone-200">
          <Button variant="primary" size="lg" loading={saving} onClick={handleSave}>
            {savedOk ? t("config_saved") : t("config_save")}
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
