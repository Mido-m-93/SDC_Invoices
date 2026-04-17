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
import {
  fetchInvoices,
  fetchValidationResults,
  fetchFiledDocuments,
  validateInvoice,
  fileInvoice,
} from "@/lib/api/client";
import type { InvoiceValidationResult } from "@/types";
import { monthOptions, formatCurrency } from "@/lib/utils";
import type { InvoiceListItem, InvoiceSubmission, InvoiceStatusCode } from "@/types";
import clsx from "clsx";

const STATUS_FILTERS: Array<"ALL" | InvoiceStatusCode> = [
  "ALL", "READY", "REVIEW_REQUIRED", "MISSING_ATTACHMENT", "SAVED", "ALREADY_PROCESSED",
];

export default function InvoicesPage() {
  const { t } = useLanguage();
  const [month, setMonth] = useState(monthOptions(1)[0]);
  const [items, setItems] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<InvoiceListItem | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

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

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const handleValidate = async (submission: InvoiceSubmission) => {
    setValidating(submission.id);
    setError(null);
    try {
      const result = await validateInvoice(submission);
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
    const approved: InvoiceValidationResult = { ...item.validation, humanApproved: true };
    const updated = { ...item, validation: approved };
    setItems((prev) =>
      prev.map((i) => (i.submission.id === item.submission.id ? updated : i))
    );
    setSelectedItem((prev) =>
      prev?.submission.id === item.submission.id ? updated : prev
    );
  };

  const filtered =
    filterStatus === "ALL"
      ? items
      : filterStatus === "SAVED"
      ? items.filter((i) => i.filedDocument != null)
      : items.filter((i) => i.validation?.statusCode === filterStatus);

  return (
    <AppShell>
      <div className="px-8 py-8">
        <PageHeader
          title={t("invoice_list_title")}
          actions={
            <div className="flex items-center gap-3">
              <MonthSelector value={month} onChange={setMonth} />
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
              {f === "ALL" ? `${t("total_rows")} (${items.length})` : f}
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
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50">
                    <Th>{t("col_payer_name")}</Th>
                    <Th>{t("col_closing_month")}</Th>
                    <Th>{t("col_project_type")}</Th>
                    <Th>{t("col_claimed_amount")}</Th>
                    <Th>PDF Date</Th>
                    <Th>Subtotal</Th>
                    <Th>Tax</Th>
                    <Th>PDF Total</Th>
                    <Th>{t("col_status")}</Th>
                    <Th>{t("col_issues")}</Th>
                    <Th>{t("col_attachment")}</Th>
                    <Th>{t("col_actions")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {filtered.map((item) => {
                    const { submission: s, validation: v } = item;
                    const isValidating = validating === s.id;
                    return (
                      <tr key={s.id} className="hover:bg-stone-50/70 transition-colors">
                        {/* Payer */}
                        <td className="px-4 py-3 font-medium text-stone-900 whitespace-nowrap">
                          <span className="text-xs text-stone-400 font-mono mr-1.5">
                            #{s.submissionRowNumber}
                          </span>
                          {s.payerName}
                        </td>

                        {/* Month */}
                        <td className="px-4 py-3 text-stone-500 whitespace-nowrap text-xs">
                          {s.closingMonth}
                        </td>

                        {/* Type */}
                        <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                          {s.projectType || t("none")}
                        </td>

                        {/* Amount */}
                        <td className="px-4 py-3 text-stone-700 font-mono text-xs whitespace-nowrap">
                          {formatCurrency(s.claimedAmountTaxIncluded)}
                        </td>

                        {/* PDF Date */}
                        <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                          {v?.extractedFields?.invoiceDate ?? <span className="text-stone-300">—</span>}
                        </td>

                        {/* Subtotal */}
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-stone-600">
                          {v?.extractedFields?.subtotal != null
                            ? `¥${v.extractedFields.subtotal.toLocaleString("ja-JP")}`
                            : <span className="text-stone-300">—</span>}
                        </td>

                        {/* Tax */}
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-stone-600">
                          {v?.extractedFields?.taxAmount != null
                            ? `¥${v.extractedFields.taxAmount.toLocaleString("ja-JP")}`
                            : <span className="text-stone-300">—</span>}
                        </td>

                        {/* PDF Total */}
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-stone-800 font-semibold">
                          {v?.extractedFields?.total != null
                            ? `¥${v.extractedFields.total.toLocaleString("ja-JP")}`
                            : <span className="text-stone-300 font-normal">—</span>}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {v ? (
                            <StatusBadge code={v.statusCode} size="sm" />
                          ) : (
                            <span className="text-xs text-stone-300">—</span>
                          )}
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

                        {/* Attachment */}
                        <td className="px-4 py-3">
                          {s.invoiceAttachment ? (
                            <a
                              href={s.invoiceAttachment}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#2d6a4f] hover:underline text-xs"
                              title={s.invoiceAttachment}
                            >
                              {t("action_open_link")} ↗
                            </a>
                          ) : (
                            <span className="text-xs text-red-400">✗</span>
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
                                ✓ Approve
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
                              <span className="text-xs text-emerald-600 font-medium">✓ Saved</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-stone-100 bg-stone-50">
              <p className="text-xs text-stone-400">
                {filtered.length} / {items.length} 件表示
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
