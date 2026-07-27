// ─────────────────────────────────────────────────────────────────────────────
// lib/utils/index.ts — Shared utility functions
// ─────────────────────────────────────────────────────────────────────────────

import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import type { InvoiceStatusCode, Language } from "@/types";

// ── ID generation ─────────────────────────────────────────────────────────────
export function generateId(prefix = "id"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Date formatting ───────────────────────────────────────────────────────────
export function formatTimestamp(iso: string, lang: Language = "ja"): string {
  try {
    const d = parseISO(iso);
    return lang === "ja"
      ? format(d, "yyyy年MM月dd日 HH:mm", { locale: ja })
      : format(d, "MMM d, yyyy HH:mm");
  } catch {
    return iso;
  }
}

export function formatDateParts(iso: string, lang: Language = "ja"): { date: string; time: string } {
  try {
    const d = parseISO(iso);
    return lang === "ja"
      ? { date: format(d, "yyyy年MM月dd日", { locale: ja }), time: format(d, "HH:mm") }
      : { date: format(d, "MMM d, yyyy"), time: format(d, "HH:mm") };
  } catch {
    return { date: iso, time: "" };
  }
}

function currentISOTimestamp(): string {
  return new Date().toISOString();
}

function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// ── Month helpers ─────────────────────────────────────────────────────────────

// Parses any common date/month string into "YYYY-MM". Returns "unknown" if
// the format is unrecognisable. Handles: "2026年5月", "2026-05", "2026-05-01",
// "5/8/26" (MM/DD/YY), "5/8/2026" (MM/DD/YYYY), "05/2026" (MM/YYYY).
// Converts an Excel serial date number (e.g. 46173) to a JS Date in UTC.
export function excelSerialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

export function parseSnapshotMonth(raw: string | undefined): string {
  if (!raw) return "unknown";
  // Excel serial date: integer or decimal in the range 40000–60000 (~2009–2064)
  const num = Number(raw);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const d = excelSerialToDate(Math.floor(num));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const jpMatch = raw.match(/(\d{4})年(\d{1,2})月/);
  if (jpMatch) return `${jpMatch[1]}-${jpMatch[2].padStart(2, "0")}`;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  const usShort = raw.match(/^(\d{1,2})\/\d{1,2}\/(\d{2})$/);
  if (usShort) return `${2000 + Number(usShort[2])}-${usShort[1].padStart(2, "0")}`;
  const usFull = raw.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
  if (usFull) return `${usFull[2]}-${usFull[1].padStart(2, "0")}`;
  const mmYyyy = raw.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmYyyy) return `${mmYyyy[2]}-${mmYyyy[1].padStart(2, "0")}`;
  const generic = raw.match(/(\d{4})[^\d](\d{1,2})/);
  if (generic) return `${generic[1]}-${generic[2].padStart(2, "0")}`;
  return "unknown";
}

export function monthOptions(count = 12): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return months;
}

export function formatMonthForDisplay(yyyyMM: string, lang: Language): string {
  const [year, month] = yyyyMM.split("-");
  if (!year || !month) return yyyyMM;
  return lang === "ja"
    ? `${year}年${month}月`
    : `${new Date(Number(year), Number(month) - 1).toLocaleString("en-US", { month: "long" })} ${year}`;
}

// ── Status badge colors ───────────────────────────────────────────────────────
export function statusColor(code: InvoiceStatusCode): {
  bg: string;
  text: string;
  dot: string;
} {
  const map: Record<
    InvoiceStatusCode,
    { bg: string; text: string; dot: string }
  > = {
    READY:                  { bg: "bg-emerald-50",  text: "text-emerald-700",  dot: "bg-emerald-500"  },
    REVIEW_REQUIRED:        { bg: "bg-amber-50",    text: "text-amber-700",    dot: "bg-amber-500"    },
    MISSING_ATTACHMENT:     { bg: "bg-red-50",      text: "text-red-700",      dot: "bg-red-500"      },
    PDF_LINK_ERROR:         { bg: "bg-red-50",      text: "text-red-700",      dot: "bg-red-500"      },
    DATE_MISSING:           { bg: "bg-orange-50",   text: "text-orange-700",   dot: "bg-orange-500"   },
    TAX_MISSING:            { bg: "bg-orange-50",   text: "text-orange-700",   dot: "bg-orange-500"   },
    AMOUNT_MISMATCH:        { bg: "bg-red-50",      text: "text-red-700",      dot: "bg-red-500"      },
    PROJECT_INFO_MISSING:   { bg: "bg-amber-50",    text: "text-amber-700",    dot: "bg-amber-500"    },
    ALREADY_PROCESSED:      { bg: "bg-slate-100",   text: "text-slate-500",    dot: "bg-slate-400"    },
    DUPLICATE_FILE:         { bg: "bg-purple-50",   text: "text-purple-700",   dot: "bg-purple-500"   },
    SAVED:                  { bg: "bg-blue-50",     text: "text-blue-700",     dot: "bg-blue-500"     },
    SAVE_ERROR:             { bg: "bg-red-100",     text: "text-red-800",      dot: "bg-red-600"      },
  };
  return map[code] ?? { bg: "bg-slate-100", text: "text-slate-500", dot: "bg-slate-400" };
}

export function logResultColor(result: "OK" | "WARNING" | "ERROR" | "SKIP"): string {
  switch (result) {
    case "OK":      return "text-emerald-600";
    case "WARNING": return "text-amber-600";
    case "ERROR":   return "text-red-600";
    case "SKIP":    return "text-slate-400";
    default:        return "text-slate-500";
  }
}

// ── Clamp / truncate ──────────────────────────────────────────────────────────
export function truncate(s: string, max = 40): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ── Currency detection ────────────────────────────────────────────────────────
// Matches symbols, ISO codes, and written names (any case, singular/plural).
const CURRENCY_PATTERNS: Array<{ patterns: (string | RegExp)[]; code: string }> = [
  { code: "USD", patterns: ["$", "USD", /\bdollars?\b/i] },
  { code: "EUR", patterns: ["€", "EUR", /\beuros?\b/i] },
  { code: "GBP", patterns: ["£", "GBP", /\bpounds?\b/i, /\bsterling\b/i] },
  { code: "KRW", patterns: ["₩", "KRW", /\bwon\b/i] },
  { code: "CNY", patterns: ["CNY", "RMB", /\byuan\b/i, /\brenminbi\b/i] },
  { code: "SGD", patterns: ["SGD", /\bsingapore\s*dollars?\b/i] },
  { code: "AUD", patterns: ["AUD", /\baustralian\s*dollars?\b/i] },
  { code: "JPY", patterns: ["JPY", /\byen\b/i, /\b円\b/, /\b円$/] },
];

export function detectCurrency(raw: string): string {
  if (!raw) return "JPY";
  for (const { code, patterns } of CURRENCY_PATTERNS) {
    for (const p of patterns) {
      if (typeof p === "string" ? raw.toUpperCase().includes(p) : p.test(raw)) {
        return code;
      }
    }
  }
  return "JPY";
}

const CURRENCY_FORMAT: Record<string, { symbol: string; locale: string }> = {
  JPY: { symbol: "¥",    locale: "ja-JP" },
  USD: { symbol: "$",    locale: "en-US" },
  EUR: { symbol: "€",    locale: "de-DE" },
  GBP: { symbol: "£",    locale: "en-GB" },
  KRW: { symbol: "₩",   locale: "ko-KR" },
  CNY: { symbol: "¥",    locale: "zh-CN" },
  SGD: { symbol: "S$",   locale: "en-SG" },
  AUD: { symbol: "A$",   locale: "en-AU" },
};

// ── Currency display ──────────────────────────────────────────────────────────
export function formatCurrency(raw: string | null | undefined, currencyOverride?: string): string {
  if (!raw) return "—";
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (isNaN(n)) return raw || "—";
  const currency = currencyOverride ?? detectCurrency(raw);
  const { symbol, locale } = CURRENCY_FORMAT[currency] ?? CURRENCY_FORMAT.JPY;
  return `${symbol}${n.toLocaleString(locale)}`;
}

export function formatAmount(n: number, currency: string): string {
  const { symbol, locale } = CURRENCY_FORMAT[currency] ?? CURRENCY_FORMAT.JPY;
  return `${symbol}${n.toLocaleString(locale)}`;
}

// ── Validation issue translation ──────────────────────────────────────────────
// Issue codes/messages are generated server-side in English (invoiceValidator.ts,
// api/invoices/validate/route.ts). This is the single place that turns them into
// Japanese for display — every render site (list previews, detail panels,
// exception reports) should go through this instead of showing the raw string.
const BARE_ISSUE_CODE_JA: Record<string, string> = {
  VALIDATION_ERROR: "検証エラー",
  MISSING_ATTACHMENT: "添付ファイルなし",
  PDF_LINK_ERROR: "リンクエラー",
  PROJECT_INFO_MISSING: "案件情報なし",
  DATE_MISSING: "日付なし",
  TAX_MISSING: "税額なし",
  DUPLICATE_FILE: "重複ファイル",
};

export function translateIssue(issue: string, language: Language): string {
  if (language !== "ja") return issue;
  if (BARE_ISSUE_CODE_JA[issue]) return BARE_ISSUE_CODE_JA[issue];

  let m = issue.match(/^Duplicate:\s*(\d+)\s*other submission\(s\)\s*for\s+(.+?)\s*this month(.*)$/i);
  if (m) {
    const [, count, name, rest] = m;
    const diff = rest.match(/amounts differ:\s*previous\s*(.+?)\s*vs current\s*(.+)$/i);
    const suffix = diff ? ` — ⚠ 金額差異あり: 前回 ${diff[1]} → 今回 ${diff[2]}` : "";
    return `重複: ${name} の今月の提出が他に ${count} 件あります${suffix}`;
  }

  if (/^PDF_PARSE_ERROR:/i.test(issue)) {
    return "⚠ 請求書PDFはダウンロードされましたが、フィールドを抽出できませんでした — 手動で確認してください。";
  }

  if (/^PDF_FIELDS_UNREADABLE:/i.test(issue)) {
    return "⚠ 請求書のテキストは読み取れましたが、日付・金額・支払先名を特定できませんでした — 手動で確認してください。";
  }

  m = issue.match(/^PAYEE_NAME_MISMATCH:\s*Submitter name\s*"(.+?)"\s*not found in invoice PDF$/i);
  if (m) return `提出者名 "${m[1]}" が請求書PDFに見つかりません`;

  m = issue.match(/^AMOUNT_MISMATCH:\s*Form\s*"(.+?)"\s*vs PDF total\s*"(.+?)"$/i);
  if (m) return `金額不一致: フォーム "${m[1]}" ↔ PDF合計 "${m[2]}"`;

  if (/^Drive check skipped:/i.test(issue)) {
    return issue.replace(/^Drive check skipped:\s*(.+)$/i, "ドライブ確認をスキップ: $1");
  }

  if (/^Drive file found:/i.test(issue)) {
    return issue
      .replace(/^Drive file found:\s*(.+)$/im, "ドライブでファイルを発見: $1")
      .replace(/Name:\s*"(.+?)"\s*✓ found in Drive/gi, '名前: "$1" ✓ ドライブで確認済み')
      .replace(
        /Amount differs\s*—\s*Drive:\s*(.+?),\s*this submission:\s*(.+?)\s*—\s*may be a different invoice/i,
        "金額が一致しません — ドライブ: $1、今回の提出: $2 — 別の請求書の可能性があります"
      );
  }

  if (/^Already filed in Drive:/i.test(issue)) {
    return issue
      .replace(/^Already filed in Drive:\s*(.+)$/im, "ドライブに既に保管済み: $1")
      .replace(/Name:\s*"(.+?)"\s*✓ found in Drive/gi, '名前: "$1" ✓ ドライブで確認済み')
      .replace(/Amount:\s*(.+?)\s*matches\s*✓/gi, "金額: $1 一致 ✓");
  }

  return issue;
}

// reviewerRecommendation is built server-side as e.g.
// "Accounting | Registered member: X (role) | Contract: 500,000 | 2024-01〜2024-12 | scope"
export function translateRecommendation(rec: string, language: Language): string {
  if (language !== "ja" || !rec) return rec;
  return rec
    .replace(/^Accounting Lead$/, "経理担当")
    .replace(/^Accounting\b/, "経理")
    .replace(/Registered member:/g, "登録済みメンバー:")
    .replace(/Contract:/g, "契約金額:")
    .replace(/⚠ Claimed amount does not match invoice PDF/g, "⚠ 請求金額が請求書PDFと一致しません");
}
