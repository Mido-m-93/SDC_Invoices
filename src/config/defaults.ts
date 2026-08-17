// ─────────────────────────────────────────────────────────────────────────────
// config/defaults.ts — Default application configuration
//
// These values are intentionally conservative and configurable.
// Do NOT hardcode business-specific Japanese values here permanently —
// load real values from Firestore app_config collection in production.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppConfig } from "@/types";

/**
 * Default config shipped with the app.
 * In production these should be overridden by values from Firestore.
 *
 * completedStatuses / skipStatuses:
 *   The exact Japanese values in 支払処理 are not yet confirmed.
 *   Add real values once the sheet schema is finalized.
 */
export const DEFAULT_CONFIG: AppConfig = {
  // 支払処理 values that mean the row is already done
  completedStatuses: [
    // Add real values e.g. "支払済み", "完了", "処理済み"
  ],

  // Rows to skip entirely (e.g. drafts, cancelled)
  skipStatuses: [
    // Add real values e.g. "キャンセル", "対象外"
  ],

  // How to build the Drive month-folder name from closingMonth
  // "YYYY-MM"     → "2024-03"
  // "YYYY年MM月"  → "2024年03月"
  // "custom"      → use monthFolderCustomTemplate
  monthFolderNamingMode: "YYYY年MM月",
  monthFolderCustomTemplate: "",

  // Filename template tokens: {payerName}, {originalFilename}, {closingMonth}
  filenameRule: "{payerName}_{originalFilename}",

  defaultLanguage: "ja",

  // Duplicate detection strategy
  // "none"     → always upload
  // "filename" → skip if same filename exists in target folder
  // "hash"     → skip if file hash matches existing file (more accurate)
  duplicateDetectionMode: "filename",

  // Absolute tolerance for amount comparison (in sheet currency unit)
  // 0 = exact match required
  amountToleranceAbsolute: 0,

  // ── Phase 7: Reminder / notification defaults ────────────────────────────
  teamsWebhookUrl: "",
  staleReviewThresholdDays: 3,
  dueDateThresholdDays: 5,
  escalationRecipient: "",
  paymentTermsDays: 30,
};

/**
 * Build the month folder name from a closingMonth string + config.
 * closingMonth may arrive in various formats; try to parse robustly.
 */
export function buildMonthFolderName(
  closingMonth: string,
  config: AppConfig
): string {
  // Try to extract year and month from various formats:
  // "2024-03", "2024/03", "2024年3月", "令和6年3月", etc.
  const iso = tryParseToYYYYMM(closingMonth);

  if (!iso) {
    // Fallback: use raw value from sheet
    return closingMonth;
  }

  const [year, month] = iso.split("-");

  switch (config.monthFolderNamingMode) {
    case "YYYY-MM":
      return `${year}-${month}`;
    case "YYYY年MM月":
      return `${year}年${month}月`;
    case "custom":
      return config.monthFolderCustomTemplate
        .replace("{YYYY}", year)
        .replace("{MM}", month)
        .replace("{closingMonth}", closingMonth);
    default:
      return closingMonth;
  }
}

/**
 * Build the final filename from config template + submission fields.
 */
export function buildFilename(
  config: AppConfig,
  params: {
    payerName: string;
    originalFilename: string;
    closingMonth: string;
  }
): string {
  const safeName = (s: string) =>
    s.replace(/[\\/:*?"<>|]/g, "_").trim();

  let name = config.filenameRule
    .replace("{payerName}", safeName(params.payerName))
    .replace("{originalFilename}", safeName(params.originalFilename))
    .replace("{closingMonth}", safeName(params.closingMonth));

  // Ensure .pdf extension
  if (!name.toLowerCase().endsWith(".pdf")) {
    name = name + ".pdf";
  }
  return name;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function tryParseToYYYYMM(raw: string): string | null {
  // ISO: "2024-03" or "2024-03-31"
  const isoMatch = raw.match(/(\d{4})[/-](\d{1,2})/);
  if (isoMatch) {
    const m = isoMatch[2].padStart(2, "0");
    return `${isoMatch[1]}-${m}`;
  }

  // Japanese: "2024年3月" or "2024年03月31日"
  const jpMatch = raw.match(/(\d{4})年\s*(\d{1,2})月/);
  if (jpMatch) {
    const m = jpMatch[2].padStart(2, "0");
    return `${jpMatch[1]}-${m}`;
  }

  return null;
}
