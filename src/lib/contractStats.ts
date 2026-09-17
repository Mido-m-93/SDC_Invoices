import type { Contract } from "@/types";

const EXPIRING_SOON_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ContractStats {
  total: number;
  active: number;
  expiringSoon: number;
}

export function computeContractStats(contracts: Contract[], now: Date): ContractStats {
  const active = contracts.filter((c) => c.status === "active");

  const expiringSoon = active.filter((c) => {
    const daysUntilEnd = (new Date(c.endDate).getTime() - now.getTime()) / MS_PER_DAY;
    return daysUntilEnd >= 0 && daysUntilEnd <= EXPIRING_SOON_WINDOW_DAYS;
  });

  return {
    total: contracts.length,
    active: active.length,
    expiringSoon: expiringSoon.length,
  };
}
