"use client";
// src/components/ui/MonthSelector.tsx

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useLanguage } from "@/translations";
import { monthOptions, formatMonthForDisplay } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (month: string) => void;
  availableMonths?: string[];
}

export default function MonthSelector({ value, onChange, availableMonths }: Props) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Merge available months (from Supabase) with the last 18 generated months,
  // dedup, sort newest-first so the user can always navigate freely.
  const generated = monthOptions(18);
  const merged = new Set([...(availableMonths ?? []), ...generated]);
  const all = Array.from(merged).sort().reverse();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-stone-500 whitespace-nowrap">
        {t("select_month")}
      </label>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className="flex items-center gap-2 text-sm border border-stone-200 rounded-lg pl-3 pr-2 py-1.5 bg-white text-stone-800 hover:border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f] focus:ring-offset-1"
        >
          {availableMonths?.includes(value) && (
            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
          )}
          <span>{formatMonthForDisplay(value, language)}</span>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="text-stone-400">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 z-20 mt-1 max-h-72 w-48 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg text-sm">
            {all.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { onChange(m); setOpen(false); }}
                className={clsx(
                  "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-stone-50",
                  m === value ? "bg-stone-50 font-medium text-stone-900" : "text-stone-700"
                )}
              >
                {availableMonths?.includes(m) ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                ) : (
                  <span className="h-2 w-2 shrink-0" />
                )}
                <span>{formatMonthForDisplay(m, language)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
