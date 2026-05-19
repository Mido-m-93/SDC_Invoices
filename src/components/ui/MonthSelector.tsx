"use client";
// src/components/ui/MonthSelector.tsx

import { useLanguage } from "@/translations";
import { monthOptions, formatMonthForDisplay } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (month: string) => void;
  availableMonths?: string[];
}

export default function MonthSelector({ value, onChange, availableMonths }: Props) {
  const { t, language } = useLanguage();

  // Merge available months (from Supabase) with the last 18 generated months,
  // dedup, sort newest-first so the user can always navigate freely.
  const generated = monthOptions(18);
  const merged = new Set([...(availableMonths ?? []), ...generated]);
  const all = Array.from(merged).sort().reverse();

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-stone-500 whitespace-nowrap">
        {t("select_month")}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm border border-stone-200 rounded-lg px-3 py-1.5 bg-white text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f] focus:ring-offset-1"
      >
        {all.map((m) => (
          <option key={m} value={m}>
            {formatMonthForDisplay(m, language)}
            {availableMonths?.includes(m) ? " ●" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
