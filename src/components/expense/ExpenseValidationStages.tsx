"use client";
import type { ExpenseClaim } from "@/types";
import { useLanguage } from "@/translations";

type StageStatus = "pass" | "warn" | "fail" | "pending";

const STYLES: Record<StageStatus, {
  card: string; numBg: string; numText: string;
  badgeBg: string; badgeText: string; icon: string; detailText: string;
}> = {
  pass: {
    card:       "bg-emerald-50 border-emerald-200",
    numBg:      "bg-emerald-500",
    numText:    "text-white",
    badgeBg:    "bg-emerald-100",
    badgeText:  "text-emerald-700",
    icon:       "✓",
    detailText: "text-emerald-700",
  },
  warn: {
    card:       "bg-amber-50 border-amber-200",
    numBg:      "bg-amber-400",
    numText:    "text-white",
    badgeBg:    "bg-amber-100",
    badgeText:  "text-amber-700",
    icon:       "⚠",
    detailText: "text-amber-700",
  },
  fail: {
    card:       "bg-red-50 border-red-200",
    numBg:      "bg-red-500",
    numText:    "text-white",
    badgeBg:    "bg-red-100",
    badgeText:  "text-red-700",
    icon:       "✕",
    detailText: "text-red-700",
  },
  pending: {
    card:       "bg-stone-50 border-stone-200",
    numBg:      "bg-stone-300",
    numText:    "text-white",
    badgeBg:    "bg-stone-100",
    badgeText:  "text-stone-500",
    icon:       "…",
    detailText: "text-stone-400",
  },
};

interface StageCardProps {
  number: number;
  title: string;
  subtitle: string;
  status: StageStatus;
  statusLabel: string;
  detail: string;
  isLast?: boolean;
}

function StageCard({ number, title, subtitle, status, statusLabel, detail, isLast }: StageCardProps) {
  const s = STYLES[status];

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.numBg} ${s.numText} shadow-sm`}>
          {number}
        </div>
        {!isLast && <div className="mt-1 h-full w-px bg-stone-200" />}
      </div>

      <div className={`mb-3 flex-1 rounded-xl border px-4 py-3 ${s.card}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-stone-800">{title}</p>
            <p className="text-xs text-stone-500">{subtitle}</p>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.badgeBg} ${s.badgeText}`}>
            {s.icon} {statusLabel}
          </span>
        </div>
        {detail && (
          <div className={`mt-2 text-xs leading-relaxed ${s.detailText} space-y-0.5`}>
            {detail.split("\n").map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


export default function ExpenseValidationStages({ claim }: { claim: ExpenseClaim }) {
  const { t } = useLanguage();
  const v = claim.policyViolations ?? [];
  const hasValidated =
    v.length > 0 ||
    claim.extractedAmount !== null ||
    claim.extractedDate !== null ||
    claim.extractedVendor !== null ||
    claim.extractedRecipient != null ||
    claim.extractedPurpose != null;

  // ── Stage 1: SharePoint member registration ───────────────────────────────
  const notRegistered = v.includes("NOT_REGISTERED_MEMBER");

  const stage1Status: StageStatus =
    !hasValidated  ? "pending" :
    notRegistered  ? "fail"    :
    "pass";

  const stage1Detail =
    !hasValidated  ? t("expenses_stage1_pending_detail") :
    notRegistered  ? t("expenses_stage1_fail_detail", { name: claim.submittedBy }) :
    t("expenses_stage1_pass_detail", { name: claim.submittedBy });

  // ── Stage 2: Receipt field comparison (or text validation fallback) ──────────
  const amountMismatch    = v.includes("AMOUNT_MISMATCH");
  const dateMismatch      = v.includes("DATE_MISMATCH");
  const missingPurpose    = v.includes("MISSING_PURPOSE");
  const missingReceipt    = v.includes("MISSING_RECEIPT");
  const purposeUnclear    = v.includes("PURPOSE_UNCLEAR") || missingPurpose;
  const categoryMismatch  = v.includes("CATEGORY_MISMATCH");
  const amountSuspicious  = v.includes("AMOUNT_SUSPICIOUS");

  const hasReceiptData = claim.extractedAmount !== null || !!claim.extractedDate || !!claim.extractedVendor;
  const anyMismatch    = amountMismatch || dateMismatch;
  const anyDataIssue   = purposeUnclear || categoryMismatch || amountSuspicious;

  const stage2Status: StageStatus =
    !hasValidated              ? "pending" :
    anyMismatch || anyDataIssue ? "fail"   :
    missingReceipt             ? "warn"    :
    "pass";

  let stage2Detail: string;
  if (!hasValidated) {
    stage2Detail = t("expenses_stage2_pending_detail");
  } else if (hasReceiptData) {
    // Receipt was found and extracted — show field-by-field comparison
    const lines: string[] = [];
    if (claim.extractedAmount !== null) {
      const ok = !amountMismatch;
      lines.push(t("expenses_stage2_amount_line", {
        currency: claim.currency,
        amount: claim.amount.toLocaleString(),
        extractedAmount: claim.extractedAmount.toLocaleString(),
        mark: ok ? "✓" : "✗",
      }));
    }
    if (claim.extractedDate) {
      const ok = !dateMismatch;
      lines.push(t("expenses_stage2_date_line", {
        expenseDate: claim.expenseDate || "—",
        extractedDate: claim.extractedDate,
        mark: ok ? "✓" : "✗",
      }));
    }
    if (claim.extractedVendor) {
      lines.push(t("expenses_stage2_vendor_line", { vendor: claim.extractedVendor }));
    }
    if (claim.extractedPurpose) {
      lines.push(t("expenses_stage2_purpose_line", { purpose: claim.extractedPurpose }));
    }
    if (!anyMismatch && lines.length > 0) lines.unshift(t("expenses_stage2_all_match"));
    stage2Detail = lines.join("\n");
  } else {
    // No receipt file found — show GPT text validation result
    const lines: string[] = [];
    if (claim.extractedPurpose) lines.push(claim.extractedPurpose);
    if (missingPurpose)   lines.push(t("expenses_stage2_no_purpose"));
    if (missingReceipt)   lines.push(t("expenses_stage2_no_receipt"));
    if (categoryMismatch) lines.push(t("expenses_stage2_category_mismatch_detail"));
    if (amountSuspicious) lines.push(t("expenses_stage2_amount_suspicious_detail"));
    if (lines.length === 0) lines.push(t("expenses_stage2_no_issues_no_receipt"));
    stage2Detail = lines.join("\n");
  }

  const stageStatusLabel = (status: StageStatus) =>
    status === "pass"    ? t("expenses_stage_status_passed") :
    status === "warn"    ? t("expenses_stage_status_review") :
    status === "fail"    ? t("expenses_stage_status_failed") :
    t("expenses_stage_status_pending");

  return (
    <div>
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-stone-400">
        {t("expenses_stages_heading")}
      </p>
      <StageCard
        number={1}
        title={t("expenses_stage1_title")}
        subtitle={t("expenses_stage1_subtitle")}
        status={stage1Status}
        statusLabel={stageStatusLabel(stage1Status)}
        detail={stage1Detail}
      />
      <StageCard
        number={2}
        title={t("expenses_stage2_title")}
        subtitle={t("expenses_stage2_subtitle")}
        status={stage2Status}
        statusLabel={stageStatusLabel(stage2Status)}
        detail={stage2Detail}
        isLast
      />
    </div>
  );
}
