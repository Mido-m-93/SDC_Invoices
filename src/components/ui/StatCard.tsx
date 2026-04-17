"use client";
// src/components/ui/StatCard.tsx

import clsx from "clsx";

interface Props {
  label: string;
  value: number | string;
  accent?: "default" | "green" | "amber" | "red" | "blue" | "slate";
  icon?: React.ReactNode;
}

const accentMap = {
  default: { border: "border-stone-200",   value: "text-stone-900",   icon: "text-stone-400"   },
  green:   { border: "border-emerald-200", value: "text-emerald-700", icon: "text-emerald-500" },
  amber:   { border: "border-amber-200",   value: "text-amber-700",   icon: "text-amber-500"   },
  red:     { border: "border-red-200",     value: "text-red-700",     icon: "text-red-500"     },
  blue:    { border: "border-blue-200",    value: "text-blue-700",    icon: "text-blue-500"    },
  slate:   { border: "border-slate-200",   value: "text-slate-500",   icon: "text-slate-400"   },
};

export default function StatCard({ label, value, accent = "default", icon }: Props) {
  const a = accentMap[accent];
  return (
    <div className={clsx("bg-white rounded-xl border p-5 flex flex-col gap-3", a.border)}>
      {icon && (
        <div className={clsx("w-8 h-8 flex items-center justify-center", a.icon)}>
          {icon}
        </div>
      )}
      <div>
        <p className="text-xs text-stone-400 font-medium uppercase tracking-wide mb-1">{label}</p>
        <p className={clsx("text-3xl font-bold tabular-nums", a.value)}>{value}</p>
      </div>
    </div>
  );
}
