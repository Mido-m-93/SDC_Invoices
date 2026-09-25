import type { Contract } from "@/types";

const EXPIRING_SOON_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ContractStats {
  total: number;
  active: number;
  expiringSoon: number;
  // Active contracts whose endDate has already passed — distinct from
  // expiringSoon (which only counts 0-30 days *ahead*), so an already-lapsed
  // contract doesn't silently fall through both buckets unnoticed.
  expired: number;
}

export function computeContractStats(contracts: Contract[], now: Date): ContractStats {
  const active = contracts.filter((c) => c.status === "active");

  // A blank/malformed endDate parses to NaN, which fails both of these
  // comparisons — correctly excluded from both buckets rather than
  // miscounted as either "expiring soon" or "expired".
  const daysUntilEnd = (c: Contract) => (new Date(c.endDate).getTime() - now.getTime()) / MS_PER_DAY;

  const expiringSoon = active.filter((c) => {
    const d = daysUntilEnd(c);
    return d >= 0 && d <= EXPIRING_SOON_WINDOW_DAYS;
  });

  const expired = active.filter((c) => daysUntilEnd(c) < 0);

  return {
    total: contracts.length,
    active: active.length,
    expiringSoon: expiringSoon.length,
    expired: expired.length,
  };
}
