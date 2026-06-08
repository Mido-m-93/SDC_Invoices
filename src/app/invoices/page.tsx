"use client";
// src/app/invoices/page.tsx

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import MonthSelector from "@/components/ui/MonthSelector";
import StatusBadge from "@/components/ui/StatusBadge";
import InvoiceDetailPanel from "@/components/invoice/InvoiceDetailPanel";
import { useLanguage } from "@/translations";
import { useCurrentUser, userColor, userInitials } from "@/lib/hooks/useCurrentUser";
import {
  fetchInvoices,
  fetchValidationResults,
  fetchFiledDocuments,
  validateInvoice,
  fileInvoice,
  uploadInvoiceExcel,
  fetchAvailableMonths,
} from "@/lib/api/client";
import type { InvoiceValidationResult } from "@/types";
import { monthOptions, formatCurrency, formatTimestamp } from "@/lib/utils";
import type { InvoiceListItem, InvoiceSubmission, InvoiceStatusCode } from "@/types";
import clsx from "clsx";

const STATUS_FILTERS: Array<"ALL" | InvoiceStatusCode> = [
  "ALL", "READY", "REVIEW_REQUIRED", "MISSING_ATTACHMENT", "SAVED", "ALREADY_PROCESSED",
];

export default function InvoicesPage() {
  const { t, language } = useLanguage();
  const { user } = useCurrentUser();
  const [month, setMonth] = useState(monthOptions(1)[0]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [items, setItems] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<InvoiceListItem | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [detectedHeaders, setDetectedHeaders] = useState<string[] | null>(null);
  const [headerMapping, setHeaderMapping] = useState<Record<string, string> | null>(null);
  const [rawPreview, setRawPreview] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const submissions = await fetchInvoices(month);
      const ids = submissions.map((s) => s.id);

      const [validations, filedDocs] = await Promise.all([
        fetchValidationResults(ids),
        fetchFiledDocuments(ids),
      ]);

      const validationMap = Object.fromEntries(validations.map((v) => [v.submissionId, v]));
      const filedMap = Object.fromEntries(filedDocs.map((fd) => [fd.submissionId, fd]));

      setItems(
        submissions.map((s) => ({
          submission: s,
          validation: validationMap[s.id] ?? null,
          filedDocument: filedMap[s.id] ?? null,
        }))
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [month]);

  // On mount: fetch available months and auto-select the most recent one with data
  useEffect(() => {
    fetchAvailableMonths().then((months) => {
      setAvailableMonths(months);
      if (months.length > 0 && !months.includes(monthOptions(1)[0])) {
        setMonth(months[0]);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const handleValidate = async (submission: InvoiceSubmission) => {
    setValidating(submission.id);
    setError(null);
    try {
      const result = await validateInvoice(submission, user ?? undefined);
      setItems((prev) =>
        prev.map((item) =>
          item.submission.id === submission.id
            ? { ...item, validation: result }
            : item
        )
      );
      // Refresh selected panel if open
      setSelectedItem((prev) =>
        prev?.submission.id === submission.id
          ? { ...prev, validation: result }
          : prev
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setValidating(null);
    }
  };

  const handleSave = async (item: InvoiceListItem) => {
    if (!item.validation) return;
    setSaving(item.submission.id);
    setError(null);
    setSavedMsg(null);
    try {
      const fd = await fileInvoice(item.validation);
      const updated = { ...item, filedDocument: fd };
      setItems((prev) =>
        prev.map((i) => (i.submission.id === item.submission.id ? updated : i))
      );
      setSelectedItem((prev) =>
        prev?.submission.id === item.submission.id ? updated : prev
      );
      setSavedMsg(`✓ ${item.submission.payerName} saved as "${fd.newFilename}"`);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(null);
    }
  };

  // Rule 10: human reviewer explicitly approves a REVIEW_REQUIRED invoice
  const handleApprove = (item: InvoiceListItem) => {
    if (!item.validation) return;
    const approved: InvoiceValidationResult = {
      ...item.validation,
      humanApproved: true,
      approvedBy: user ?? undefined,
    };
    const updated = { ...item, validation: approved };
    setItems((prev) =>
      prev.map((i) => (i.submission.id === item.submission.id ? updated : i))
    );
    setSelectedItem((prev) =>
      prev?.submission.id === item.submission.id ? updated : prev
    );
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // allow re-selecting same file
    setUploading(true);
    setError(null);
    setSavedMsg(null);
    setDetectedHeaders(null);
    setHeaderMapping(null);
    setRawPreview(null);
    try {
      const { submissions, snapshotMonth, detectedHeaders: headers, headerMapping: mapping, rawPreview: preview } = await uploadInvoiceExcel(file);
      setRawPreview(preview);
      if (submissions.length === 0) {
        setDetectedHeaders(headers);
        setHeaderMapping(mapping);
        setSavedMsg(null);
        setError(`0 rows matched — column headers not recognized. See detected headers below.`);
      } else {
        setSavedMsg(`✓ Loaded ${submissions.length} rows from "${file.name}"`);
        if (snapshotMonth && snapshotMonth !== "unknown") {
          setAvailableMonths((prev) =>
            prev.includes(snapshotMonth) ? prev : [snapshotMonth, ...prev]
          );
          if (snapshotMonth !== month) {
            setMonth(snapshotMonth); // triggers useEffect → loadInvoices
          } else {
            loadInvoices(); // month unchanged — reload manually
          }
        } else {
          setItems(submissions.map((s) => ({ submission: s, validation: null, filedDocument: null })));
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const filtered =
    filterStatus === "ALL"
      ? items
      : filterStatus === "SAVED"
      ? items.filter((i) => i.filedDocument != null)
      : items.filter((i) => i.validation?.statusCode === filterStatus);

  const tabCount = (f: string): number => {
    if (f === "ALL") return items.length;
    if (f === "SAVED") return items.filter((i) => i.filedDocument != null).length;
    if (f === "MISSING_ATTACHMENT") return items.filter((i) =>
      i.validation?.statusCode === "MISSING_ATTACHMENT" || (!i.validation && !i.submission.invoiceAttachment)
    ).length;
    if (f === "ALREADY_PROCESSED") return items.filter((i) =>
      ["ALREADY_PROCESSED", "DUPLICATE_FILE"].includes(i.validation?.statusCode ?? "")
    ).length;
    return items.filter((i) => i.validation?.statusCode === f).length;
  };

  return (
    <AppShell>
      <div>
        <PageHeader
          title={t("invoice_list_title")}
          actions={
            <div className="flex items-center gap-3">
              <MonthSelector value={month} onChange={setMonth} availableMonths={availableMonths} />
              {/* Excel file upload (workaround while waiting for Graph API approval) */}
              <label className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer transition-all select-none
                ${uploading
                  ? "border-stone-200 text-stone-300 bg-stone-50 cursor-not-allowed"
                  : "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"}`}
              >
                <UploadIcon />
                {uploading ? t("btn_reading") : t("btn_upload_excel")}
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  disabled={uploading}
                  onChange={handleExcelUpload}
                />
              </label>
              <Button
                variant="primary"
                size="md"
                loading={loading}
                onClick={loadInvoices}
                icon={<RefreshIcon />}
              >
                {t("load_invoices")}
              </Button>
            </div>
          }
        />

        {/* Error banner */}
        {error && (
          <div className="mb-5 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700 font-mono">
            {error}
          </div>
        )}

        {/* Detected headers debug panel */}
        {detectedHeaders && detectedHeaders.length > 0 && (
          <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-xs text-amber-800">
            <p className="font-semibold mb-2">{t("col_mapping_title")} ({detectedHeaders.length}):</p>
            <div className="flex flex-wrap gap-1.5">
              {detectedHeaders.map((h) => {
                const mapped = headerMapping?.[h] ?? t("unmapped");
                const isUnmapped = !headerMapping?.[h];
                return (
                  <span key={h} className={`font-mono px-2 py-0.5 rounded border ${isUnmapped ? "bg-white border-amber-200 text-amber-600" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
                    {h} → <strong>{mapped}</strong>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Success banner */}
        {savedMsg && (
          <div className="mb-5 bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 text-sm text-emerald-700 flex items-center justify-between">
            <span>{savedMsg}</span>
            <button onClick={() => setSavedMsg(null)} className="text-emerald-400 hover:text-emerald-600 text-lg leading-none">×</button>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilterStatus(f)}
              className={clsx(
                "text-xs px-3 py-1.5 rounded-full border font-medium transition-all",
                filterStatus === f
                  ? "bg-[#1a1a2e] text-white border-[#1a1a2e]"
                  : "bg-white text-stone-500 border-stone-200 hover:border-stone-300"
              )}
            >
              {t(f === "ALL" ? "total_rows" : `status_${f}` as Parameters<typeof t>[0])}
              <span className={clsx(
                "ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold",
                filterStatus === f ? "bg-white/20 text-white" : "bg-stone-100 text-stone-500"
              )}>
                {tabCount(f)}
              </span>
            </button>
          ))}
        </div>

        {/* Table */}
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-stone-400 text-sm">
            {t("loading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-stone-400 text-sm">
            {t("no_data")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-stone-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50">
                    <Th>{t("col_name")}</Th>
                    <Th>{t("col_email")}</Th>
                    <Th>{t("col_submitted_at")}</Th>
                    <Th>{t("col_which_month")}</Th>
                    <Th>{t("col_invoice_category")}</Th>
                    <Th>{t("col_invoice_amount")}</Th>
                    <Th>{t("col_attachment")}</Th>
                    <Th>{t("col_status")}</Th>
                    <Th>{t("col_issues")}</Th>
                    <Th>{t("col_actions")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {filtered.map((item) => {
                    const { submission: s, validation: v } = item;
                    const isValidating = validating === s.id;
                    return (
                      <tr key={s.id} className="hover:bg-stone-50/70 transition-colors">
                        {/* Name */}
                        <td className="px-4 py-3 font-medium text-stone-900 whitespace-nowrap">
                          <span className="text-xs text-stone-400 font-mono mr-1.5">#{s.submissionRowNumber}</span>
                          {s.payerName}
                        </td>

                        {/* Email */}
                        <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                          {s.email || <span className="text-stone-300">—</span>}
                        </td>

                        {/* Submitted at */}
                        <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                          {s.submittedAt ? formatTimestamp(s.submittedAt, language) : <span className="text-stone-300">—</span>}
                        </td>

                        {/* Month */}
                        <td className="px-4 py-3 text-stone-500 whitespace-nowrap text-xs">
                          {s.closingMonth || <span className="text-stone-300">—</span>}
                        </td>

                        {/* Invoice Category */}
                        <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                          {s.projectType || <span className="text-stone-300">—</span>}
                        </td>

                        {/* Amount */}
                        <td className="px-4 py-3 text-stone-700 font-mono text-xs whitespace-nowrap">
                          {formatCurrency(s.claimedAmountTaxIncluded)}
                        </td>

                        {/* Attachment */}
                        <td className="px-4 py-3 max-w-[160px]">
                          {s.invoiceAttachment ? (
                            /^https?:\/\//i.test(s.invoiceAttachment) ? (
                              <a href={s.invoiceAttachment} target="_blank" rel="noopener noreferrer"
                                className="text-[#2d6a4f] hover:underline text-xs truncate block">
                                {t("action_open_link")} ↗
                              </a>
                            ) : (
                              <span className="text-xs text-stone-600 font-mono truncate block" title={s.invoiceAttachment}>
                                📎 {s.invoiceAttachment}
                              </span>
                            )
                          ) : (
                            <span className="text-xs text-red-400">✗ {t("no_file")}</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {v ? (
                              <StatusBadge code={v.statusCode} size="sm" />
                            ) : (
                              <span className="text-xs text-stone-300">—</span>
                            )}
                            {v?.validatedBy && (
                              <span
                                title={`Validated by ${v.validatedBy}`}
                                className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white"
                                style={{ backgroundColor: userColor(v.validatedBy) }}
                              >
                                {userInitials(v.validatedBy)}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Issues */}
                        <td className="px-4 py-3 max-w-[200px]">
                          {v && v.issues.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {v.issues.slice(0, 2).map((issue) => (
                                <span
                                  key={issue}
                                  className="text-[10px] font-mono bg-red-50 text-red-600 px-1.5 py-0.5 rounded"
                                >
                                  {issue}
                                </span>
                              ))}
                              {v.issues.length > 2 && (
                                <span className="text-[10px] text-stone-400">
                                  +{v.issues.length - 2}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-stone-300">{t("no_issues")}</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedItem(item)}
                            >
                              {t("action_view")}
                            </Button>
                            {!v && (
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={isValidating}
                                onClick={() => handleValidate(s)}
                              >
                                {t("action_validate")}
                              </Button>
                            )}
                            {v?.statusCode === "REVIEW_REQUIRED" && !v.humanApproved && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleApprove(item)}
                                title="Approve for filing after human review"
                              >
                                ✓ {t("action_approve")}
                              </Button>
                            )}
                            {(v?.statusCode === "READY" || v?.humanApproved) && !item.filedDocument && (
                              <Button
                                variant="primary"
                                size="sm"
                                loading={saving === s.id}
                                onClick={() => handleSave(item)}
                              >
                                {t("action_save")}
                              </Button>
                            )}
                            {item.filedDocument && (
                              <span className="text-xs text-emerald-600 font-medium">✓ {t("saved")}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

            <div className="px-4 py-3 border-t border-stone-100 bg-stone-50">
              <p className="text-xs text-stone-400">
                {filtered.length} / {items.length} {t("items_shown")}
              </p>
            </div>
          </div>
        )}
      </div>

      {selectedItem && (
        <InvoiceDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </AppShell>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wider whitespace-nowrap">
      {children}
    </th>
  );
}

function RefreshIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
}

function UploadIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
}
