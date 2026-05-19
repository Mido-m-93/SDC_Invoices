"use client";

import clsx from "clsx";

interface Props {
  label: string;
  value: number | string;
  accent?: "default" | "green" | "amber" | "red" | "blue" | "slate";
  icon?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}

const accentMap = {
  default: {
    bg: "bg-white",
    border: "border-stone-200",
    label: "text-stone-400",
    value: "text-stone-900",
    icon: "text-stone-400",
  },
  green: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    label: "text-emerald-600",
    value: "text-emerald-700",
    icon: "text-emerald-500",
  },
  amber: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    label: "text-amber-600",
    value: "text-amber-700",
    icon: "text-amber-500",
  },
  red: {
    bg: "bg-red-50",
    border: "border-red-200",
    label: "text-red-500",
    value: "text-red-700",
    icon: "text-red-500",
  },
  blue: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    label: "text-blue-500",
    value: "text-blue-700",
    icon: "text-blue-500",
  },
  slate: {
    bg: "bg-slate-50",
    border: "border-slate-200",
    label: "text-slate-400",
    value: "text-slate-500",
    icon: "text-slate-400",
  },
};

export default function StatCard({
  label,
  value,
  accent = "default",
  icon,
  onClick,
  active = false,
}: Props) {
  const a = accentMap[accent];

  return (
    <div
      onClick={onClick}
      className={clsx(
        "rounded-xl border p-5 shadow-sm",
        "flex min-h-[132px] flex-col justify-between gap-3",
        a.bg,
        active ? "border-[#1a1a2e] ring-2 ring-[#1a1a2e]/10" : a.border,
        onClick && "cursor-pointer hover:shadow-md transition-shadow",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={clsx("text-xs font-medium uppercase tracking-wide", a.label)}>
          {label}
        </p>
        {icon && (
          <div
            className={clsx("flex h-8 w-8 items-center justify-center", a.icon)}
          >
            {icon}
          </div>
        )}
      </div>

      <p className={clsx("text-3xl font-bold tabular-nums", a.value)}>
        {value}
      </p>
    </div>
  );
}
