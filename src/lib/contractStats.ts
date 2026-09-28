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

// Compare by calendar day (UTC midnight), not the exact current instant —
// otherwise a contract ending "today" reads as already expired the moment
// any time has passed since midnight, hours before the day is actually over.
function startOfDayUTC(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// A blank/malformed endDate parses to NaN, which fails both of these
// comparisons — correctly excluded from both buckets rather than
// miscounted as either "expiring soon" or "expired".
function daysUntilEnd(c: Contract, now: Date): number {
  return (new Date(c.endDate).getTime() - startOfDayUTC(now)) / MS_PER_DAY;
}

// Shared with the Contracts page table, so the same "active but the end
// date has already passed" definition drives both the dashboard count and
// the per-row indicator — one place to change if the rule ever does.
export function isContractExpired(c: Contract, now: Date): boolean {
  return c.status === "active" && daysUntilEnd(c, now) < 0;
}

export function isContractExpiringSoon(c: Contract, now: Date): boolean {
  if (c.status !== "active") return false;
  const d = daysUntilEnd(c, now);
  return d >= 0 && d <= EXPIRING_SOON_WINDOW_DAYS;
}

export function computeContractStats(contracts: Contract[], now: Date): ContractStats {
  const active = contracts.filter((c) => c.status === "active");
  const expiringSoon = contracts.filter((c) => isContractExpiringSoon(c, now));
  const expired = contracts.filter((c) => isContractExpired(c, now));

  return {
    total: contracts.length,
    active: active.length,
    expiringSoon: expiringSoon.length,
    expired: expired.length,
  };
}
