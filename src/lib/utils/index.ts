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

// ── Month helpers ─────────────────────────────────────────────────────────────
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
