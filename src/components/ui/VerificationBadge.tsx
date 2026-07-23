"use client";

import type { ConsistencyVerdict } from "@/types";

interface VerificationBadgeProps {
  verification?: ConsistencyVerdict;
  onVerify: () => void;
  verifying: boolean;
  verifyLabel: string;
  reverifyLabel: string;
}

export default function VerificationBadge({ verification, onVerify, verifying, verifyLabel, reverifyLabel }: VerificationBadgeProps) {
  if (!verification) {
    return (
      <button
        onClick={onVerify}
        disabled={verifying}
        className="text-xs text-blue-600 hover:underline disabled:text-stone-300"
      >
        {verifying ? "…" : verifyLabel}
      </button>
    );
  }

  const badgeClass = verification.consistent
    ? "bg-emerald-50 text-emerald-700"
    : "bg-amber-50 text-amber-700";

  return (
    <div className="flex flex-col items-start gap-0.5">
      <span
        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badgeClass}`}
        title={verification.discrepancies.join("\n")}
      >
        {verification.consistent ? "✅" : "⚠️"} {verification.discrepancies.length > 0 ? `${verification.discrepancies.length} issue(s)` : "Verified"}
      </span>
      <button onClick={onVerify} disabled={verifying} className="text-xs text-stone-400 hover:text-stone-600 disabled:text-stone-200">
        {verifying ? "…" : reverifyLabel}
      </button>
    </div>
  );
}
