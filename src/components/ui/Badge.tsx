"use client";
// src/components/ui/Badge.tsx

import clsx from "clsx";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClasses: Record<BadgeTone, string> = {
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-red-100 text-red-700",
  info: "bg-blue-50 text-blue-700",
  neutral: "bg-stone-100 text-stone-500",
};

interface Props {
  tone: BadgeTone;
  children: React.ReactNode;
  className?: string;
}

export default function Badge({ tone, children, className }: Props) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
