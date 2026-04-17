"use client";
// src/components/invoice/InvoiceDetailPanel.tsx

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
                  <a
                    href={s.invoiceAttachment}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#2d6a4f] underline text-xs font-mono break-all"
                  >
                    {s.invoiceAttachment}
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
