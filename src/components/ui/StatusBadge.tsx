"use client";
// src/components/ui/StatusBadge.tsx

import clsx from "clsx";
import { useLanguage } from "@/translations";
import { statusColor } from "@/lib/utils";
import type { InvoiceStatusCode } from "@/types";
import type { TranslationKey } from "@/translations";

interface Props {
  code: InvoiceStatusCode;
  size?: "sm" | "md";
}

export default function StatusBadge({ code, size = "md" }: Props) {
  const { t } = useLanguage();
  const key = `status_${code}` as TranslationKey;
  const colors = statusColor(code);

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        colors.bg,
        colors.text,
        size === "sm" ? "text-xs px-2 py-0.5" : "text-xs px-2.5 py-1"
      )}
    >
      <span className={clsx("rounded-full flex-shrink-0", colors.dot, size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2")} />
      {t(key)}
    </span>
  );
}
