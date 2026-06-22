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

export function currentISOTimestamp(): string {
  return new Date().toISOString();
}

export function currentYearMonth(): string {
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

// ── Currency display ──────────────────────────────────────────────────────────
export function formatCurrency(raw: string): string {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (isNaN(n)) return raw || "—";
  return `¥${n.toLocaleString("ja-JP")}`;
}

export function detectCurrency(raw: string): string {
  if (/[$＄]/.test(raw)) return "USD";
  if (/[€]/.test(raw)) return "EUR";
  return "JPY";
}
