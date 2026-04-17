"use client";
// src/components/ui/ValidationCheck.tsx

import clsx from "clsx";

interface Props {
  label: string;
  pass: boolean | null; // null = unknown
}

export default function ValidationCheck({ label, pass }: Props) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-stone-100 last:border-0">
      <span className="text-sm text-stone-600">{label}</span>
      <span
        className={clsx(
          "text-xs font-mono font-semibold px-2 py-0.5 rounded",
          pass === true  && "bg-emerald-50 text-emerald-600",
          pass === false && "bg-red-50 text-red-600",
          pass === null  && "bg-stone-100 text-stone-400"
        )}
      >
        {pass === true ? "✓" : pass === false ? "✗" : "?"}
      </span>
    </div>
  );
}
