import { computeContractStats } from "@/lib/contractStats";
import type { Contract } from "@/types";

function makeContract(overrides: Partial<Contract>): Contract {
  return {
    id: "c1",
    vendorId: "",
    projectName: "Test project",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    expectedMonthlyAmount: 0,
    currency: "JPY",
    paymentTerms: "",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeContractStats", () => {
  it("counts the total number of contracts regardless of status", () => {
    const contracts = [
      makeContract({ id: "1", status: "active" }),
      makeContract({ id: "2", status: "draft" }),
      makeContract({ id: "3", status: "expired" }),
    ];

    const stats = computeContractStats(contracts, new Date("2026-06-01"));

    expect(stats.total).toBe(3);
  });

  it("counts only contracts with status active", () => {
    const contracts = [
      makeContract({ id: "1", status: "active" }),
      makeContract({ id: "2", status: "signed" }),
      makeContract({ id: "3", status: "cancelled" }),
    ];

    const stats = computeContractStats(contracts, new Date("2026-06-01"));

    expect(stats.active).toBe(1);
  });

  it("counts an active contract ending in exactly 30 days as expiring soon", () => {
    const contracts = [makeContract({ status: "active", endDate: "2026-07-01" })];

    const stats = computeContractStats(contracts, new Date("2026-06-01"));

    expect(stats.expiringSoon).toBe(1);
  });

  it("does not count an active contract ending in 31 days as expiring soon", () => {
    const contracts = [makeContract({ status: "active", endDate: "2026-07-02" })];

    const stats = computeContractStats(contracts, new Date("2026-06-01"));

    expect(stats.expiringSoon).toBe(0);
  });

  it("does not count a non-active contract as expiring soon even if its end date is near", () => {
    const contracts = [makeContract({ status: "expired", endDate: "2026-06-05" })];

    const stats = computeContractStats(contracts, new Date("2026-06-01"));

    expect(stats.expiringSoon).toBe(0);
  });

  it("does not count an active contract whose end date has already passed", () => {
    const contracts = [makeContract({ status: "active", endDate: "2026-05-31" })];

    const stats = computeContractStats(contracts, new Date("2026-06-01"));

    expect(stats.expiringSoon).toBe(0);
  });

  it("returns all-zero stats for an empty contracts array", () => {
    const stats = computeContractStats([], new Date("2026-06-01"));

    expect(stats).toEqual({ total: 0, active: 0, expiringSoon: 0 });
  });

  it("counts active as 0 when no contract has status active", () => {
    const contracts = [
      makeContract({ id: "1", status: "draft" }),
      makeContract({ id: "2", status: "expired" }),
      makeContract({ id: "3", status: "cancelled" }),
    ];

    const stats = computeContractStats(contracts, new Date("2026-06-01"));

    expect(stats.total).toBe(3);
    expect(stats.active).toBe(0);
    expect(stats.expiringSoon).toBe(0);
  });

  it("excludes an active contract with a malformed endDate from expiringSoon instead of throwing", () => {
    const contracts = [makeContract({ status: "active", endDate: "not-a-date" })];

    const stats = computeContractStats(contracts, new Date("2026-06-01"));

    expect(stats.active).toBe(1);
    expect(stats.expiringSoon).toBe(0);
  });
});
