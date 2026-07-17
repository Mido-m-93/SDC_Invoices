"use client";
// src/components/invoice/InvoiceDetailPanel.tsx

import { useState } from "react";
import { useLanguage } from "@/translations";
import StatusBadge from "@/components/ui/StatusBadge";
import Button from "@/components/ui/Button";
import ValidationCheck from "@/components/ui/ValidationCheck";
import type { InvoiceListItem } from "@/types";
import { formatCurrency, formatTimestamp, formatAmount, detectCurrency } from "@/lib/utils";
import ValidationStages from "@/components/invoice/ValidationStages";

interface Props {
  item: InvoiceListItem;
  onClose: () => void;
  onSendToMF?: (item: InvoiceListItem) => void;
  sendingToMF?: boolean;
}

export default function InvoiceDetailPanel({ item, onClose, onSendToMF, sendingToMF }: Props) {
  const { t, language } = useLanguage();
  const { submission: s, validation: v, filedDocument: fd } = item;
  const currency = s.currency ?? detectCurrency(s.claimedAmountTaxIncluded ?? "");

  // ── Add as Vendor state ───────────────────────────────────────────────────
  const [addingVendor, setAddingVendor]     = useState(false);
  const [vendorName, setVendorName]         = useState(s.payerName ?? "");
  const [vendorSaving, setVendorSaving]     = useState(false);
  const [vendorAdded, setVendorAdded]       = useState(false);
  const [vendorError, setVendorError]       = useState<string | null>(null);
  const [savedVendorId, setSavedVendorId]   = useState<string | null>(null);

  // ── Add as Contract state ─────────────────────────────────────────────────
  const [addingContract, setAddingContract]       = useState(false);
  const [contractProject, setContractProject]     = useState(s.externalProjectName ?? s.projectType ?? "");
  const [contractStart, setContractStart]         = useState("");
  const [contractEnd, setContractEnd]             = useState("");
  const [contractSaving, setContractSaving]       = useState(false);
  const [contractAdded, setContractAdded]         = useState(false);
  const [contractError, setContractError]         = useState<string | null>(null);

  // ── Derived / optimistic state ────────────────────────────────────────────
  const effectiveVendorMatched   = (v?.vendorMatched   ?? false) || vendorAdded;
  const effectiveContractMatched = (v?.contractMatched ?? false) || contractAdded;
  const effectiveRiskLevel = (() => {
    if (!v?.riskLevel || v.riskLevel === "OK" || v.riskLevel === "BLOCKED") return v?.riskLevel;
    if (effectiveVendorMatched && effectiveContractMatched) return "OK";
    return v.riskLevel;
  })();

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleAddVendor() {
    if (!vendorName.trim()) return;
    setVendorSaving(true);
    setVendorError(null);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: vendorName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { vendor: { id: string } };
      setSavedVendorId(data.vendor.id);
      setVendorAdded(true);
      setAddingVendor(false);
    } catch (err) {
      setVendorError(err instanceof Error ? err.message : String(err));
    } finally {
      setVendorSaving(false);
    }
  }

  async function handleAddContract() {
    setContractSaving(true);
    setContractError(null);
    try {
      // Resolve vendorId: use just-created vendor, or look up by name
      let vendorId = savedVendorId;
      if (!vendorId) {
        const res = await fetch("/api/vendors");
        if (res.ok) {
          const data = await res.json() as { vendors: Array<{ id: string; name: string }> };
          const match = data.vendors.find(
            (vnd) => vnd.name.toLowerCase() === (s.payerName ?? "").toLowerCase()
          );
          vendorId = match?.id ?? null;
        }
      }
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: vendorId ?? "",
          projectName: contractProject.trim(),
          startDate: contractStart,
          endDate: contractEnd,
          currency,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setContractAdded(true);
      setAddingContract(false);
    } catch (err) {
      setContractError(err instanceof Error ? err.message : String(err));
    } finally {
      setContractSaving(false);
    }
  }

  function normalizeDisplayDate(raw: string | null | undefined): string {
    if (!raw) return "—";
    const jp = raw.match(/(\d{4})年(\d{1,2})月[\-\s]?(\d{1,2})日?/);
    if (jp) return `${jp[1]}-${jp[2].padStart(2, "0")}-${jp[3].padStart(2, "0")}`;
    return raw;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" style={{ marginLeft: "var(--sidebar-w)" }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-stone-900/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative bg-white h-full w-full max-w-2xl shadow-2xl overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-stone-100 px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-stone-400 mb-0.5 font-mono">Row {s.submissionRowNumber}</p>
            <h2 className="text-lg font-semibold text-stone-900">{s.payerName}</h2>
          </div>
          <div className="flex items-center gap-3">
            {v && <StatusBadge code={effectiveRiskLevel ?? v.statusCode} />}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <CloseIcon />
            </Button>
          </div>
        </div>

        <div className="flex-1 px-6 py-5 space-y-6">
          {/* ── Sheet data ──────────────────────────────────────────── */}
          <Section title={t("section_sheet_data")}>
            <FieldGrid>
              <Field label={t("field_payer_name")}>{s.payerName}</Field>
              <Field label={t("field_closing_month")}>{s.closingMonth}</Field>
              <Field label={t("field_project_type")}>{s.projectType || t("none")}</Field>
              <Field label={t("field_claimed_amount")}>{formatCurrency(s.claimedAmountTaxIncluded, s.currency)}</Field>
              <Field label={t("field_internal_dept")}>{s.internalDepartment || t("none")}</Field>
              <Field label={t("field_external_project")}>{s.externalProjectName || t("none")}</Field>
              <Field label={t("field_payment_status")}>{s.paymentStatus || t("none")}</Field>
              <Field label={t("field_payment_processing")}>{s.paymentProcessingStatus || t("none")}</Field>
              {s.notes && (
                <Field label={t("field_notes")} span>
                  {s.notes}
                </Field>
              )}
              <Field label={t("field_attachment")} span>
                {s.invoiceAttachment ? (
                  <a
                    href={s.invoiceAttachment}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-[#2d6a4f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#235c43]"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    Open Attachment
                  </a>
                ) : (
                  <span className="text-red-500 text-xs">{t("missing_attachment")}</span>
                )}
              </Field>
            </FieldGrid>
          </Section>

          {/* ── Extracted fields ─────────────────────────────────────── */}
          {v && (
            <Section title={t("section_extracted")}>
              {v.extractedFields ? (
                <FieldGrid>
                  <Field label={t("field_invoice_date")}>
                    {normalizeDisplayDate(v.extractedFields.invoiceDate)}
                  </Field>
                  <Field label={t("field_subtotal")}>
                    {v.extractedFields.subtotal !== null
                      ? formatAmount(v.extractedFields.subtotal, currency)
                      : t("not_found")}
                  </Field>
                  <Field label={t("field_tax_amount")}>
                    {v.extractedFields.taxAmount !== null
                      ? formatAmount(v.extractedFields.taxAmount, currency)
                      : t("not_found")}
                  </Field>
                  <Field label={t("field_total")}>
                    {v.extractedFields.total !== null
                      ? formatAmount(v.extractedFields.total, currency)
                      : t("not_found")}
                  </Field>
                  <Field label="Member">
                    {v.extractedFields.memberName ?? t("not_found")}
                  </Field>
                </FieldGrid>
              ) : (
                <p className="text-sm text-stone-400 italic">{t("not_found")}</p>
              )}
            </Section>
          )}

          {/* ── Validation stages ────────────────────────────────────── */}
          {v && (
            <Section title="">
              <ValidationStages v={v} submission={s} />
              {onSendToMF && (
                <div className="mt-3">
                  {!v.mfBillingUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={!!sendingToMF}
                      onClick={() => onSendToMF(item)}
                    >
                      💴 {t("action_send_to_mf")}
                    </Button>
                  )}
                  {v.mfBillingUrl && (
                    <a
                      href={v.mfBillingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline whitespace-nowrap"
                      title={t("mf_sent")}
                    >
                      💴 {t("action_view_in_mf")}
                    </a>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* ── Add as Vendor banner ─────────────────────────────────── */}
          {v && !effectiveVendorMatched && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold text-amber-800">
                  ⚠️ Vendor not registered
                </p>
                {!addingVendor && (
                  <button
                    onClick={() => setAddingVendor(true)}
                    className="text-xs font-semibold text-amber-700 underline hover:text-amber-900"
                  >
                    + Add as Vendor
                  </button>
                )}
              </div>
              <p className="text-xs text-amber-700 mb-3">
                &ldquo;{s.payerName}&rdquo; is not in the vendor list. Add them to clear this flag.
              </p>
              {addingVendor && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    placeholder="Vendor name"
                    className="w-full rounded border border-amber-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  {vendorError && (
                    <p className="text-xs text-red-600">{vendorError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      disabled={vendorSaving || !vendorName.trim()}
                      onClick={handleAddVendor}
                      className="rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {vendorSaving ? "Saving…" : "Save Vendor"}
                    </button>
                    <button
                      onClick={() => setAddingVendor(false)}
                      className="text-xs text-amber-700 underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {vendorAdded && (
            <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3">
              <p className="text-sm font-semibold text-green-800">✓ Vendor added successfully</p>
            </div>
          )}

          {/* ── Add as Contract banner ───────────────────────────────── */}
          {v && !effectiveContractMatched && (
            <div className="rounded-lg border border-blue-300 bg-blue-50 p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold text-blue-800">
                  📄 No active contract found
                </p>
                {!addingContract && (
                  <button
                    onClick={() => setAddingContract(true)}
                    className="text-xs font-semibold text-blue-700 underline hover:text-blue-900"
                  >
                    + Add Contract
                  </button>
                )}
              </div>
              <p className="text-xs text-blue-700 mb-3">
                No contract on file for &ldquo;{s.payerName}&rdquo;. Add one to clear this flag.
              </p>
              {addingContract && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={contractProject}
                    onChange={(e) => setContractProject(e.target.value)}
                    placeholder="Project name"
                    className="w-full rounded border border-blue-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-medium text-blue-700 uppercase tracking-wide">Start date</label>
                      <input
                        type="date"
                        value={contractStart}
                        onChange={(e) => setContractStart(e.target.value)}
                        className="w-full rounded border border-blue-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-blue-700 uppercase tracking-wide">End date</label>
                      <input
                        type="date"
                        value={contractEnd}
                        onChange={(e) => setContractEnd(e.target.value)}
                        className="w-full rounded border border-blue-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                  </div>
                  {contractError && (
                    <p className="text-xs text-red-600">{contractError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      disabled={contractSaving}
                      onClick={handleAddContract}
                      className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {contractSaving ? "Saving…" : "Save Contract"}
                    </button>
                    <button
                      onClick={() => setAddingContract(false)}
                      className="text-xs text-blue-700 underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {contractAdded && (
            <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3">
              <p className="text-sm font-semibold text-green-800">✓ Contract added successfully</p>
            </div>
          )}

          {/* ── Validation results ───────────────────────────────────── */}
          {v && (
            <Section title={t("section_validation")}>
              {v.issues.length > 0 && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-700 mb-2">
                    {t("review_required")}
                  </p>
                  <ul className="space-y-1">
                    {v.issues.flatMap((issue) =>
                      issue.split("\n").filter(Boolean)
                    ).map((line, idx) => (
                      <li key={idx} className="text-xs text-amber-700 font-mono">
                        • {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="bg-stone-50 rounded-lg px-4 divide-y divide-stone-100">
                <ValidationCheck label={t("validation_pdf_accessible")} pass={v.pdfAccessible} />
                <ValidationCheck label={t("validation_date_found")} pass={v.invoiceDateFound} />
                <ValidationCheck label={t("validation_tax_included")} pass={v.taxIncluded} />
                <ValidationCheck label={t("validation_subtotal_found")} pass={v.subtotalFound} />
                <ValidationCheck label={t("validation_total_found")} pass={v.totalFound} />
                <ValidationCheck label={t("validation_amount_consistent")} pass={v.amountConsistent} />
                <ValidationCheck label={t("validation_amount_matches_sheet")} pass={v.amountMatchesSheet} />
                <ValidationCheck label={t("validation_no_duplicate")} pass={!v.duplicateDetected} />
              </div>
            </Section>
          )}

          {/* ── Filing info ──────────────────────────────────────────── */}
          {v && (
            <Section title={t("section_filing")}>
              <FieldGrid>
                <Field label={t("field_proposed_filename")} span>
                  <span className="font-mono text-xs text-stone-700 break-all">
                    {v.proposedFilename}
                  </span>
                </Field>
                <Field label={t("field_target_folder")} span>
                  <span className="font-mono text-xs text-stone-700">
                    {v.targetFolderPath}
                  </span>
                </Field>
              </FieldGrid>

              {fd && (
                <>
                  <div className="mt-4 border-t border-stone-100 pt-4">
                    <p className="text-xs text-stone-400 mb-2 font-semibold uppercase tracking-wide">
                      {t("saved")}
                    </p>
                    <FieldGrid>
                      <Field label={t("field_drive_link")} span>
                        <a
                          href={fd.driveWebViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#2d6a4f] underline text-xs font-mono break-all"
                        >
                          {fd.driveWebViewLink}
                        </a>
                      </Field>
                      <Field label={t("field_saved_at")}>
                        {formatTimestamp(fd.savedAt, language)}
                      </Field>
                    </FieldGrid>
                  </div>
                </>
              )}
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-stone-100 px-6 py-4">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function Field({
  label,
  children,
  span,
}: {
  label: string;
  children: React.ReactNode;
  span?: boolean;
}) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wide mb-0.5">
        {label}
      </p>
      <p className="text-sm text-stone-800">{children}</p>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
