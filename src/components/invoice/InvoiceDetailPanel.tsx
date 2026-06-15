"use client";
// src/components/invoice/InvoiceDetailPanel.tsx

import { useState } from "react";
import { useLanguage } from "@/translations";
import StatusBadge from "@/components/ui/StatusBadge";
import Button from "@/components/ui/Button";
import ValidationCheck from "@/components/ui/ValidationCheck";
import type { InvoiceListItem } from "@/types";
import { formatCurrency, formatTimestamp } from "@/lib/utils";

interface Props {
  item: InvoiceListItem;
  onClose: () => void;
}

export default function InvoiceDetailPanel({ item, onClose }: Props) {
  const { t, language } = useLanguage();
  const { submission: s, validation: v, filedDocument: fd } = item;

  // ── Vendor state ──────────────────────────────────────────────────────────────
  const [addingVendor, setAddingVendor] = useState(false);
  const [vendorName, setVendorName] = useState(s.payerName ?? "");
  const [vendorSaving, setVendorSaving] = useState(false);
  const [vendorAdded, setVendorAdded] = useState(false);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [savedVendorId, setSavedVendorId] = useState<string | null>(null);

  // ── Contract state ────────────────────────────────────────────────────────────
  const [addingContract, setAddingContract] = useState(false);
  const [contractProject, setContractProject] = useState(s.externalProjectName ?? s.projectType ?? "");
  const [contractStart, setContractStart] = useState("");
  const [contractEnd, setContractEnd] = useState("");
  const [contractSaving, setContractSaving] = useState(false);
  const [contractAdded, setContractAdded] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);

  // Optimistic UI: reflect changes immediately without re-validating
  const effectiveVendorMatched = (v?.vendorMatched ?? false) || vendorAdded;
  const effectiveContractMatched = (v?.contractMatched ?? false) || contractAdded;
  const effectiveRiskLevel = (() => {
    if (!v?.riskLevel || v.riskLevel === "OK" || v.riskLevel === "BLOCKED") return v?.riskLevel;
    if (effectiveVendorMatched && effectiveContractMatched) return "OK";
    return v.riskLevel;
  })();

  async function handleAddVendor() {
    setVendorSaving(true);
    setVendorError(null);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: vendorName.trim() }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { vendor: { id: string } };
      setSavedVendorId(data.vendor.id);
      setVendorAdded(true);
      setAddingVendor(false);
    } catch (err) {
      setVendorError(err instanceof Error ? err.message : "Failed to add vendor");
    } finally {
      setVendorSaving(false);
    }
  }

  async function handleAddContract() {
    setContractSaving(true);
    setContractError(null);
    try {
      // Resolve vendorId: use the one just created, or look up existing vendor by name
      let vendorId = savedVendorId;
      if (!vendorId) {
        const vRes = await fetch("/api/vendors");
        if (!vRes.ok) throw new Error("Failed to fetch vendors");
        const vData = await vRes.json() as { vendors: Array<{ id: string; name: string; aliases?: string[] }> };
        const match = vData.vendors.find(
          (vnd) =>
            vnd.name.toLowerCase() === (s.payerName ?? "").toLowerCase() ||
            vnd.aliases?.some((a) => a.toLowerCase() === (s.payerName ?? "").toLowerCase())
        );
        if (!match) throw new Error("Vendor not found — please add the vendor first");
        vendorId = match.id;
      }
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          projectName: contractProject.trim() || s.payerName,
          startDate: contractStart,
          endDate: contractEnd,
          status: "active",
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setContractAdded(true);
      setAddingContract(false);
    } catch (err) {
      setContractError(err instanceof Error ? err.message : "Failed to add contract");
    } finally {
      setContractSaving(false);
    }
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
            {v && <StatusBadge code={v.statusCode} />}
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
              <Field label={t("field_claimed_amount")}>{formatCurrency(s.claimedAmountTaxIncluded)}</Field>
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
                  <div className="space-y-2">
                    <a
                      href={s.invoiceAttachment}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#2d6a4f] underline text-xs font-mono break-all"
                    >
                      {s.invoiceAttachment}
                    </a>
                    <iframe
                      src={s.invoiceAttachment}
                      className="w-full rounded-lg border border-stone-200"
                      style={{ height: 400 }}
                      title="Invoice PDF"
                    />
                  </div>
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
                    {v.extractedFields.invoiceDate ?? t("not_found")}
                  </Field>
                  <Field label={t("field_subtotal")}>
                    {v.extractedFields.subtotal !== null
                      ? `¥${v.extractedFields.subtotal.toLocaleString("ja-JP")}`
                      : t("not_found")}
                  </Field>
                  <Field label={t("field_tax_amount")}>
                    {v.extractedFields.taxAmount !== null
                      ? `¥${v.extractedFields.taxAmount.toLocaleString("ja-JP")}`
                      : t("not_found")}
                  </Field>
                  <Field label={t("field_total")}>
                    {v.extractedFields.total !== null
                      ? `¥${v.extractedFields.total.toLocaleString("ja-JP")}`
                      : t("not_found")}
                  </Field>
                </FieldGrid>
              ) : (
                <p className="text-sm text-stone-400 italic">{t("not_found")}</p>
              )}
            </Section>
          )}

          {/* ── Risk assessment ──────────────────────────────────────── */}
          {v && (v.riskLevel || v.vendorMatched !== undefined) && (
            <Section title="Risk Assessment">
              <div className="space-y-3">
                {v.riskLevel && (
                  <div className={`flex items-center justify-between rounded-lg px-4 py-3 ${
                    effectiveRiskLevel === "OK" ? "bg-green-50 border border-green-200" :
                    effectiveRiskLevel === "BLOCKED" ? "bg-red-50 border border-red-200" :
                    "bg-amber-50 border border-amber-200"
                  }`}>
                    <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Risk Level</span>
                    <span className={`text-sm font-bold ${
                      effectiveRiskLevel === "OK" ? "text-green-700" :
                      effectiveRiskLevel === "BLOCKED" ? "text-red-700" :
                      "text-amber-700"
                    }`}>
                      {effectiveRiskLevel === "OK" ? "✓ OK" : effectiveRiskLevel === "BLOCKED" ? "✕ BLOCKED" : "⚠ NEEDS REVIEW"}
                    </span>
                  </div>
                )}
                <div className="bg-stone-50 rounded-lg px-4 divide-y divide-stone-100">
                  <ValidationCheck label="Vendor Registered" pass={effectiveVendorMatched} />
                  <ValidationCheck label="Active Contract Found" pass={effectiveContractMatched} />
                </div>

                {/* Add as Vendor — shown when vendor is not registered */}
                {!v.vendorMatched && !vendorAdded && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
                    {!addingVendor ? (
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-amber-700">Vendor not registered in the system.</p>
                        <button
                          onClick={() => setAddingVendor(true)}
                          className="text-xs font-semibold text-amber-800 underline hover:text-amber-900"
                        >
                          + Add as Vendor
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-amber-800">Register as new vendor</p>
                        <input
                          type="text"
                          value={vendorName}
                          onChange={(e) => setVendorName(e.target.value)}
                          placeholder="Vendor name"
                          className="w-full rounded border border-amber-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                        {vendorError && (
                          <p className="text-xs text-red-600">{vendorError}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={handleAddVendor}
                            disabled={vendorSaving || !vendorName.trim()}
                            className="rounded bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                          >
                            {vendorSaving ? "Saving…" : "Save Vendor"}
                          </button>
                          <button
                            onClick={() => setAddingVendor(false)}
                            className="rounded px-3 py-1 text-xs text-stone-500 hover:text-stone-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {vendorAdded && (
                  <p className="text-xs text-green-700 font-semibold px-1">✓ Vendor added successfully</p>
                )}

                {/* Add as Contract — shown when contract is not found */}
                {!v.contractMatched && !contractAdded && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 space-y-2">
                    {!addingContract ? (
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-blue-700">No active contract found.</p>
                        <button
                          onClick={() => setAddingContract(true)}
                          className="text-xs font-semibold text-blue-800 underline hover:text-blue-900"
                        >
                          + Add Contract
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-blue-800">Register new contract</p>
                        <input
                          type="text"
                          value={contractProject}
                          onChange={(e) => setContractProject(e.target.value)}
                          placeholder="Project name"
                          className="w-full rounded border border-blue-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[10px] text-blue-700 mb-0.5">Start date</p>
                            <input
                              type="date"
                              value={contractStart}
                              onChange={(e) => setContractStart(e.target.value)}
                              className="w-full rounded border border-blue-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </div>
                          <div>
                            <p className="text-[10px] text-blue-700 mb-0.5">End date</p>
                            <input
                              type="date"
                              value={contractEnd}
                              onChange={(e) => setContractEnd(e.target.value)}
                              className="w-full rounded border border-blue-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </div>
                        </div>
                        {contractError && (
                          <p className="text-xs text-red-600">{contractError}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={handleAddContract}
                            disabled={contractSaving || !contractStart || !contractEnd}
                            className="rounded bg-blue-700 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                          >
                            {contractSaving ? "Saving…" : "Save Contract"}
                          </button>
                          <button
                            onClick={() => setAddingContract(false)}
                            className="rounded px-3 py-1 text-xs text-stone-500 hover:text-stone-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {contractAdded && (
                  <p className="text-xs text-green-700 font-semibold px-1">✓ Contract added successfully</p>
                )}

                {v.reviewerRecommendation && (
                  <div className="flex items-center gap-2 text-xs text-stone-500 px-1">
                    <span className="font-medium">Recommended Reviewer:</span>
                    <span className="text-stone-700 font-semibold">{v.reviewerRecommendation}</span>
                  </div>
                )}
              </div>
            </Section>
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
                    {v.issues.map((issue) => (
                      <li key={issue} className="text-xs text-amber-700 font-mono">
                        • {issue}
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
