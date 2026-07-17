"use client";
import type { InvoiceValidationResult, InvoiceSubmission } from "@/types";
import { useLanguage } from "@/translations";
import { formatAmount, detectCurrency } from "@/lib/utils";

type StageStatus = "pass" | "warn" | "fail";

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
      {/* Left: number + connector line */}
      <div className="flex flex-col items-center">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.numBg} ${s.numText} shadow-sm`}>
          {number}
        </div>
        {!isLast && <div className="mt-1 h-full w-px bg-stone-200" />}
      </div>

      {/* Right: card content */}
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

export default function ValidationStages({ v, submission }: { v: InvoiceValidationResult; submission?: InvoiceSubmission }) {
  const { t, language } = useLanguage();
  const statusLabel = (s: StageStatus) =>
    s === "pass" ? t("stage_status_passed") : s === "warn" ? t("stage_status_review") : t("stage_status_failed");
  // ── Stage 1: Invoice PDF vs Form input only ───────────────────────────────
  // Exclude Drive issues and duplicate issues — those belong to Stage 3 and Stage 2.
  const pdfParseError = v.issues.find((i) => i.startsWith("PDF_PARSE_ERROR"));
  const pdfIssues = v.issues.filter(
    (i) =>
      !i.toLowerCase().includes("already filed in drive") &&
      !i.toLowerCase().startsWith("drive file found:") &&
      !i.toLowerCase().startsWith("drive check skipped:") &&
      !i.toLowerCase().startsWith("duplicate:")
  );

  const stage1Status: StageStatus =
    !v.pdfAccessible ? "fail" :
    !v.amountMatchesSheet || !v.invoiceDateFound || !v.taxIncluded || pdfIssues.length > 0 ? "warn" :
    !v.vendorMatched ? "warn" :
    "pass";

  // Build explicit comparison lines
  const formAmount    = submission?.claimedAmountTaxIncluded?.trim() ?? null;
  const pdfTotal      = v.extractedFields?.total ?? v.extractedFields?.subtotal ?? null;
  const rawPayerName  = submission?.payerName?.trim() ?? null;
  const isEmailPayer  = !!rawPayerName?.includes("@");
  // memberName = the actual name on the invoice PDF (who issued it).
  // Always prefer this over the form's payerName, which may be a nickname or email.
  const pdfPayeeName  = v.extractedFields?.memberName ?? null;
  const displayName   = pdfPayeeName ?? (isEmailPayer ? null : rawPayerName);
  const amountLine = formAmount && pdfTotal !== null
    ? t("stage1_amount_line").replace("{form}", formAmount).replace("{pdf}", String(pdfTotal)) + (v.amountMatchesSheet ? " ✓" : " ✗")
    : null;
  // If the AI extracted a memberName, that name came FROM the PDF — it's always "found".
  // Only show ✗ when extraction found no member name at all.
  const nameLine = pdfPayeeName
    ? t("stage1_name_found").replace("{name}", pdfPayeeName)
    : rawPayerName && !isEmailPayer
    ? t("stage1_name_missing").replace("{name}", rawPayerName)
    : isEmailPayer
    ? t("stage1_email_payer")
    : null;

  const unverifiedLine = !v.vendorMatched && pdfIssues.length === 0 && v.amountMatchesSheet
    ? t("stage1_no_vendor")
    : null;

  const stage1Detail =
    !v.pdfAccessible ? t("stage1_no_pdf") :
    pdfParseError ? t("stage1_parse_error") :
    pdfIssues.length > 0
      ? [...pdfIssues.filter((i) => !i.startsWith("PDF_PARSE_ERROR")), amountLine, nameLine].filter(Boolean).join("\n")
      : [amountLine, nameLine, unverifiedLine].filter(Boolean).join("\n") || t("stage1_ok");

  // ── Stage 2: Within-store duplicate check ─────────────────────────────────
  const dupIssue = v.issues.find((i) => i.toLowerCase().startsWith("duplicate:"));

  const stage2Status: StageStatus = !dupIssue ? "pass" : "warn";

  const stage2Detail = (() => {
    if (!dupIssue) return t("stage2_ok");
    const m = dupIssue.match(/Duplicate:\s*(\d+)\s*other submission\(s\)\s*for\s+(.+?)\s*this month/i);
    if (!m) return dupIssue;
    const [, count, name] = m;
    return language === "ja"
      ? `重複: ${name} の今月の提出が他に ${count} 件あります`
      : `Duplicate: ${count} other submission(s) for ${name} this month`;
  })();

  // ── Stage 3: Google Drive filing check ────────────────────────────────────
  // "Already filed in Drive:" → matched, amounts agree
  // "Drive file found:"       → matched, amounts differ (different invoice)
  const driveIssue   = v.issues.find(
    (i) => i.toLowerCase().includes("already filed in drive") || i.toLowerCase().startsWith("drive file found:")
  );
  const driveSkipped = v.issues.find((i) => i.toLowerCase().startsWith("drive check skipped:"));

  const stage3Status: StageStatus =
    driveSkipped ? "warn" :
    !driveIssue  ? "pass" :
    "warn";

  // Always show the AI-extracted member name for Drive search label; fall back to form name
  const driveSearchLabel = pdfPayeeName ?? rawPayerName ?? "this member";

  const currency = detectCurrency(submission?.claimedAmountTaxIncluded ?? "");
  const pdfAmountStr = pdfTotal !== null ? formatAmount(pdfTotal, currency) : null;

  const stage3Detail = (() => {
    if (driveSkipped) return `⚠ ${driveSkipped.replace(/^drive check skipped:\s*/i, "").trim()} — ${t("stage3_manual")}`;
    if (!driveIssue) {
      const base = t("stage3_ok").replace("{name}", driveSearchLabel);
      return pdfAmountStr
        ? `${base}\n${language === "ja" ? `照合した金額: ${pdfAmountStr}` : `Checked amount: ${pdfAmountStr}`}`
        : base;
    }
    if (language !== "ja") return driveIssue;
    // Translate the Drive filing message line by line
    return driveIssue
      .replace(/^Already filed in Drive:/i, "ドライブに既に保管済み:")
      .replace(/Name:\s*"(.+?)"\s*✓ found in Drive/g, '名前: "$1" ✓ ドライブで確認済み')
      .replace(/Amount:\s*(.+?)\s*matches\s*✓/g, '金額: $1 一致 ✓');
  })();

  // ── Stage 4: SharePoint contractor check ──────────────────────────────────
  const stage4Status: StageStatus =
    v.vendorMatched ? "pass" :
    "warn";

  const stage4Detail =
    v.vendorMatched
      ? (v.reviewerRecommendation
          ? `${t("stage4_registered")} ${v.reviewerRecommendation}`
          : t("stage4_found"))
      : t("stage4_not_found");

  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-stone-400">
        {t("stage_section_title")}
      </p>
      <StageCard
        number={1}
        title={t("stage1_title")}
        subtitle={t("stage1_subtitle")}
        status={stage1Status}
        statusLabel={statusLabel(stage1Status)}
        detail={stage1Detail}
      />
      <StageCard
        number={2}
        title={t("stage2_title")}
        subtitle={t("stage2_subtitle")}
        status={stage2Status}
        statusLabel={statusLabel(stage2Status)}
        detail={stage2Detail}
      />
      <StageCard
        number={3}
        title={t("stage3_title")}
        subtitle={t("stage3_subtitle")}
        status={stage3Status}
        statusLabel={statusLabel(stage3Status)}
        detail={stage3Detail}
      />
      <StageCard
        number={4}
        title={t("stage4_title")}
        subtitle={t("stage4_subtitle")}
        status={stage4Status}
        statusLabel={statusLabel(stage4Status)}
        detail={stage4Detail}
        isLast
      />
    </div>
  );
}
