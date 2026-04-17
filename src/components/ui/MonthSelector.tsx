"use client";
// src/components/ui/MonthSelector.tsx

import { useLanguage } from "@/translations";
import { monthOptions, formatMonthForDisplay } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (month: string) => void;
}

export default function MonthSelector({ value, onChange }: Props) {
  const { t, language } = useLanguage();
  const options = monthOptions(18);

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
        {options.map((m) => (
          <option key={m} value={m}>
            {formatMonthForDisplay(m, language)}
          </option>
        ))}
      </select>
    </div>
  );
}
