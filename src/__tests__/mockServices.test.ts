// ─────────────────────────────────────────────────────────────────────────────
// __tests__/mockServices.test.ts
//
// Integration tests for the five new mock service classes added in Phase 11:
//   MockClientService, MockLeadService, MockMemberService,
//   MockAccountingService, MockReportingService
//
// Strategy (Robo Co-op principle: no mock abuse):
//   - MockAccountingService and MockReportingService hold state in-memory only
//     and are tested with zero mocks — real code, real assertions.
//   - MockClientService, MockLeadService, MockMemberService delegate to
//     fileStore which writes to the filesystem. The fileStore module is mocked
//     at the boundary (filesystem) so tests remain hermetic and fast.
//
// What is NOT tested here:
//   - SupabaseClientService / SupabaseLeadService / SupabaseMemberService /
//     SupabaseAccountingService / SupabaseReportingService — these need a real
//     or containerised Supabase instance (integration/e2e scope).
//   - MockValidationService risk-scoring paths that depend on fileStore vendor /
//     contract data — covered separately in invoiceValidator.test.ts area.
//   - MockLeadService.updateStage when the lead id does NOT exist (no-op path)
//     — listed as LOW priority in the audit.
// ─────────────────────────────────────────────────────────────────────────────

import type { Client, Lead, Member, AccountingEntry } from "@/types";

// ── Shared fixture builders ───────────────────────────────────────────────────

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    name: "Acme Corp",
    legalName: "Acme Corporation Ltd.",
    industry: "Technology",
    contactName: "Alice",
    contactEmail: "alice@acme.com",
    contactPhone: "090-0000-0001",
    address: "1-1 Shibuya, Tokyo",
    country: "JP",
    taxRegistrationNumber: "T1234567890123",
    status: "active",
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    clientId: "client-1",
    clientName: "Acme Corp",
    contactName: "Bob",
    contactEmail: "bob@acme.com",
    source: "inbound",
    stage: "new",
    title: "Web Redesign Project",
    estimatedValue: 1_000_000,
    currency: "JPY",
    probability: 0.5,
    expectedCloseDate: "2026-09-30",
    assignedTo: "sales-01",
    proposalId: null,
    notes: "",
    lostReason: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: "member-1",
    displayName: "Carol Smith",
    email: "carol@sdc.co.jp",
    phone: "090-0000-0002",
    role: "engineer",
    department: "Development",
    employeeCode: "EMP-001",
    joinDate: "2025-04-01",
    status: "active",
    avatarUrl: "",
    notes: "",
    createdAt: "2025-04-01T00:00:00Z",
    updatedAt: "2025-04-01T00:00:00Z",
    ...overrides,
  };
}

function makeEntry(overrides: Partial<AccountingEntry> = {}): AccountingEntry {
  return {
    id: "entry-1",
    entryDate: "2026-05-01",
    month: "2026-05",
    type: "revenue",
    category: "consulting",
    description: "May consulting fees",
    amount: 500_000,
    currency: "JPY",
    exchangeRate: 1,
    amountJpy: 500_000,
    status: "draft",
    sourceType: "manual",
    sourceId: "",
    clientId: "client-1",
    vendorId: "",
    memberId: "",
    notes: "",
    postedBy: "",
    postedAt: null,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MockClientService
// ─────────────────────────────────────────────────────────────────────────────

// Mock the fileStore at the filesystem boundary.
// Each variable is initialised to an empty array and overwritten per-test
// so tests stay independent.

const clientStore: Client[] = [];

jest.mock("@/lib/services/mock/fileStore", () => {
  const leadStore: Lead[] = [];
  const memberStore: Member[] = [];

  return {
    loadClients: () => [...clientStore],
    saveClient: (c: Client) => {
      const idx = clientStore.findIndex((x) => x.id === c.id);
      if (idx >= 0) clientStore[idx] = c;
      else clientStore.push(c);
    },
    deleteClient: (id: string) => {
      const idx = clientStore.findIndex((x) => x.id === id);
      if (idx >= 0) clientStore.splice(idx, 1);
    },

    loadLeads: () => [...leadStore],
    saveLead: (l: Lead) => {
      const idx = leadStore.findIndex((x) => x.id === l.id);
      if (idx >= 0) leadStore[idx] = l;
      else leadStore.push(l);
    },
    deleteLead: (id: string) => {
      const idx = leadStore.findIndex((x) => x.id === id);
      if (idx >= 0) leadStore.splice(idx, 1);
    },

    loadMembers: () => [...memberStore],
    saveMember: (m: Member) => {
      const idx = memberStore.findIndex((x) => x.id === m.id);
      if (idx >= 0) memberStore[idx] = m;
      else memberStore.push(m);
    },
    deleteMember: (id: string) => {
      const idx = memberStore.findIndex((x) => x.id === id);
      if (idx >= 0) memberStore.splice(idx, 1);
    },

    // Other fileStore exports used by MockValidationService — not under test
    // here; return safe defaults so the import does not crash.
    loadVendors: () => [],
    saveVendor: jest.fn(),
    deleteVendor: jest.fn(),
    loadContracts: () => [],
    saveContract: jest.fn(),
    deleteContract: jest.fn(),
    loadProposals: () => [],
    saveProposal: jest.fn(),
    deleteProposal: jest.fn(),
    loadPaymentRecords: () => [],
    savePaymentRecord: jest.fn(),
    deletePaymentRecord: jest.fn(),
    loadUploadedSubmissions: () => [],
    saveUploadedSubmissions: jest.fn(),
    loadValidationResults: () => [],
    saveValidationResult: jest.fn(),
    loadFiledDocuments: () => [],
    saveFiledDocument: jest.fn(),
    loadRuns: () => [],
    saveRun: jest.fn(),
    loadLogs: () => [],
    appendLog: jest.fn(),
  };
});

// Import AFTER jest.mock so the mock is in place.
import {
  MockClientService,
  MockLeadService,
  MockMemberService,
  MockAccountingService,
  MockReportingService,
} from "@/lib/services/mock/index";

// Helper: clear the shared client store before each test.
beforeEach(() => {
  clientStore.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
// MockClientService tests
// ─────────────────────────────────────────────────────────────────────────────

describe("MockClientService", () => {
  let svc: MockClientService;

  beforeEach(() => {
    svc = new MockClientService();
  });

  // Happy path ─────────────────────────────────────────────────────────────

  it("listClients returns empty array when store is empty", async () => {
    const result = await svc.listClients();
    expect(result).toEqual([]);
  });

  it("saveClient persists and listClients returns the record", async () => {
    const client = makeClient();
    await svc.saveClient(client);
    const list = await svc.listClients();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(client);
  });

  it("saveClient upserts when same id is saved twice", async () => {
    const client = makeClient();
    await svc.saveClient(client);
    const updated = { ...client, name: "Acme Updated" };
    await svc.saveClient(updated);
    const list = await svc.listClients();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Acme Updated");
  });

  it("getClient returns the correct client by id", async () => {
    const client = makeClient();
    await svc.saveClient(client);
    const found = await svc.getClient("client-1");
    expect(found).toEqual(client);
  });

  it("getClient returns null for an unknown id", async () => {
    const result = await svc.getClient("does-not-exist");
    expect(result).toBeNull();
  });

  it("deleteClient removes the record", async () => {
    const client = makeClient();
    await svc.saveClient(client);
    await svc.deleteClient("client-1");
    const list = await svc.listClients();
    expect(list).toHaveLength(0);
  });

  it("deleteClient is a no-op when the id is not present", async () => {
    await svc.saveClient(makeClient());
    await svc.deleteClient("nonexistent");
    expect(await svc.listClients()).toHaveLength(1);
  });

  // Boundary ───────────────────────────────────────────────────────────────

  it("listClients handles multiple clients in store", async () => {
    const c1 = makeClient({ id: "c1", name: "Alpha" });
    const c2 = makeClient({ id: "c2", name: "Beta" });
    await svc.saveClient(c1);
    await svc.saveClient(c2);
    const list = await svc.listClients();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.id)).toContain("c1");
    expect(list.map((c) => c.id)).toContain("c2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MockLeadService tests
// ─────────────────────────────────────────────────────────────────────────────

describe("MockLeadService", () => {
  let svc: MockLeadService;

  beforeEach(async () => {
    svc = new MockLeadService();
    // seed the in-module leadStore via the service itself
    // (the mock's leadStore is scoped to the jest.mock factory, cleared
    //  here by re-importing a fresh service — deleteLead is used instead)
    for (const l of await svc.listLeads()) {
      await svc.deleteLead(l.id);
    }
  });

  // Happy path ─────────────────────────────────────────────────────────────

  it("listLeads returns empty array when store is empty", async () => {
    expect(await svc.listLeads()).toEqual([]);
  });

  it("saveLead persists and listLeads returns the record", async () => {
    await svc.saveLead(makeLead());
    const list = await svc.listLeads();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("lead-1");
  });

  it("getLead returns correct lead by id", async () => {
    const lead = makeLead();
    await svc.saveLead(lead);
    expect(await svc.getLead("lead-1")).toEqual(lead);
  });

  it("getLead returns null for unknown id", async () => {
    expect(await svc.getLead("missing")).toBeNull();
  });

  it("deleteLead removes the record", async () => {
    await svc.saveLead(makeLead());
    await svc.deleteLead("lead-1");
    expect(await svc.listLeads()).toHaveLength(0);
  });

  // Filtering ──────────────────────────────────────────────────────────────

  it("listLeads filters by stage", async () => {
    await svc.saveLead(makeLead({ id: "l1", stage: "new" }));
    await svc.saveLead(makeLead({ id: "l2", stage: "won" }));
    const newLeads = await svc.listLeads({ stage: "new" });
    expect(newLeads).toHaveLength(1);
    expect(newLeads[0].id).toBe("l1");
  });

  it("listLeads with no filters returns all leads", async () => {
    await svc.saveLead(makeLead({ id: "l1", stage: "new" }));
    await svc.saveLead(makeLead({ id: "l2", stage: "won" }));
    expect(await svc.listLeads()).toHaveLength(2);
  });

  // updateStage ────────────────────────────────────────────────────────────

  it("updateStage changes the stage of an existing lead", async () => {
    await svc.saveLead(makeLead({ stage: "new" }));
    await svc.updateStage("lead-1", "qualified", "actor");
    const found = await svc.getLead("lead-1");
    expect(found?.stage).toBe("qualified");
  });

  // getSummary ─────────────────────────────────────────────────────────────

  it("getSummary returns zero totals when store is empty", async () => {
    const summary = await svc.getSummary();
    expect(summary.total).toBe(0);
    expect(summary.totalPipelineValue).toBe(0);
    expect(summary.currency).toBe("JPY");
  });

  it("getSummary counts all stages and initialises missing stages to 0", async () => {
    await svc.saveLead(makeLead({ id: "l1", stage: "new" }));
    await svc.saveLead(makeLead({ id: "l2", stage: "won" }));
    const summary = await svc.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.byStage.new).toBe(1);
    expect(summary.byStage.won).toBe(1);
    expect(summary.byStage.lost).toBe(0);
  });

  it("getSummary does not include won/lost estimatedValues in pipeline", async () => {
    await svc.saveLead(makeLead({ id: "l1", stage: "won", estimatedValue: 999_999 }));
    await svc.saveLead(makeLead({ id: "l2", stage: "qualified", estimatedValue: 200_000 }));
    const summary = await svc.getSummary();
    expect(summary.totalPipelineValue).toBe(200_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MockMemberService tests
// ─────────────────────────────────────────────────────────────────────────────

describe("MockMemberService", () => {
  let svc: MockMemberService;

  beforeEach(async () => {
    svc = new MockMemberService();
    for (const m of await svc.listMembers()) {
      await svc.deleteMember(m.id);
    }
  });

  // Happy path ─────────────────────────────────────────────────────────────

  it("listMembers returns empty array initially", async () => {
    expect(await svc.listMembers()).toEqual([]);
  });

  it("saveMember persists and listMembers returns it", async () => {
    await svc.saveMember(makeMember());
    const list = await svc.listMembers();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("member-1");
  });

  it("getMember returns correct member by id", async () => {
    const member = makeMember();
    await svc.saveMember(member);
    expect(await svc.getMember("member-1")).toEqual(member);
  });

  it("getMember returns null for unknown id", async () => {
    expect(await svc.getMember("unknown")).toBeNull();
  });

  it("saveMember upserts when same id is saved twice", async () => {
    await svc.saveMember(makeMember());
    await svc.saveMember(makeMember({ displayName: "Carol Jones" }));
    const list = await svc.listMembers();
    expect(list).toHaveLength(1);
    expect(list[0].displayName).toBe("Carol Jones");
  });

  it("deleteMember removes the record", async () => {
    await svc.saveMember(makeMember());
    await svc.deleteMember("member-1");
    expect(await svc.listMembers()).toHaveLength(0);
  });

  it("deleteMember with unknown id leaves store unchanged", async () => {
    await svc.saveMember(makeMember());
    await svc.deleteMember("ghost");
    expect(await svc.listMembers()).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MockAccountingService tests  (pure in-memory — no fileStore dependency)
// ─────────────────────────────────────────────────────────────────────────────

describe("MockAccountingService", () => {
  let svc: MockAccountingService;

  beforeEach(() => {
    // Fresh instance = fresh Map — no shared state between tests.
    svc = new MockAccountingService();
  });

  // Happy path ─────────────────────────────────────────────────────────────

  it("listEntries returns empty array on fresh instance", async () => {
    expect(await svc.listEntries()).toEqual([]);
  });

  it("saveEntry persists and listEntries returns it", async () => {
    await svc.saveEntry(makeEntry());
    const list = await svc.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("entry-1");
  });

  it("getEntry returns correct entry by id", async () => {
    const entry = makeEntry();
    await svc.saveEntry(entry);
    expect(await svc.getEntry("entry-1")).toEqual(entry);
  });

  it("getEntry returns null for unknown id", async () => {
    expect(await svc.getEntry("nope")).toBeNull();
  });

  it("deleteEntry removes the record", async () => {
    await svc.saveEntry(makeEntry());
    await svc.deleteEntry("entry-1");
    expect(await svc.listEntries()).toHaveLength(0);
  });

  // Filtering ──────────────────────────────────────────────────────────────

  it("listEntries filters by month", async () => {
    await svc.saveEntry(makeEntry({ id: "e1", month: "2026-05" }));
    await svc.saveEntry(makeEntry({ id: "e2", month: "2026-06" }));
    const may = await svc.listEntries({ month: "2026-05" });
    expect(may).toHaveLength(1);
    expect(may[0].id).toBe("e1");
  });

  it("listEntries filters by type", async () => {
    await svc.saveEntry(makeEntry({ id: "e1", type: "revenue" }));
    await svc.saveEntry(makeEntry({ id: "e2", type: "expense" }));
    const expenses = await svc.listEntries({ type: "expense" });
    expect(expenses).toHaveLength(1);
    expect(expenses[0].id).toBe("e2");
  });

  it("listEntries filters by status", async () => {
    await svc.saveEntry(makeEntry({ id: "e1", status: "draft" }));
    await svc.saveEntry(makeEntry({ id: "e2", status: "posted" }));
    const drafts = await svc.listEntries({ status: "draft" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe("e1");
  });

  it("listEntries combines multiple filters (AND semantics)", async () => {
    await svc.saveEntry(makeEntry({ id: "e1", month: "2026-05", type: "revenue", status: "draft" }));
    await svc.saveEntry(makeEntry({ id: "e2", month: "2026-05", type: "expense", status: "draft" }));
    const result = await svc.listEntries({ month: "2026-05", type: "revenue" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e1");
  });

  // postEntry ──────────────────────────────────────────────────────────────

  it("postEntry changes status to posted and records actor + timestamp", async () => {
    await svc.saveEntry(makeEntry({ status: "draft" }));
    await svc.postEntry("entry-1", "Accountant A");
    const posted = await svc.getEntry("entry-1");
    expect(posted?.status).toBe("posted");
    expect(posted?.postedBy).toBe("Accountant A");
    expect(posted?.postedAt).not.toBeNull();
  });

  it("postEntry is a no-op when entry does not exist", async () => {
    // Should not throw; store remains empty.
    await expect(svc.postEntry("ghost", "actor")).resolves.toBeUndefined();
    expect(await svc.listEntries()).toHaveLength(0);
  });

  // voidEntry ──────────────────────────────────────────────────────────────

  it("voidEntry changes status to voided and records actor", async () => {
    await svc.saveEntry(makeEntry({ status: "posted" }));
    await svc.voidEntry("entry-1", "Auditor B");
    const voided = await svc.getEntry("entry-1");
    expect(voided?.status).toBe("voided");
    expect(voided?.postedBy).toBe("Auditor B");
  });

  it("voidEntry is a no-op when entry does not exist", async () => {
    await expect(svc.voidEntry("ghost", "actor")).resolves.toBeUndefined();
  });

  // getProfitAndLoss ────────────────────────────────────────────────────────

  it("getProfitAndLoss returns zero-filled structure for any month", async () => {
    const pl = await svc.getProfitAndLoss("2026-05");
    expect(pl.month).toBe("2026-05");
    expect(pl.totalRevenue).toBe(0);
    expect(pl.totalExpenses).toBe(0);
    expect(pl.grossProfit).toBe(0);
    expect(pl.grossMarginPct).toBe(0);
    expect(pl.currency).toBe("JPY");
  });

  // getSummary ─────────────────────────────────────────────────────────────

  it("getSummary returns zero totals when store is empty", async () => {
    const summary = await svc.getSummary("2026-05");
    expect(summary.entryCount).toBe(0);
    expect(summary.draftCount).toBe(0);
    expect(summary.revenue).toBe(0);
    expect(summary.expenses).toBe(0);
    expect(summary.profit).toBe(0);
    expect(summary.currency).toBe("JPY");
  });

  it("getSummary counts drafts independently of posted entries", async () => {
    await svc.saveEntry(makeEntry({ id: "e1", month: "2026-05", status: "draft" }));
    await svc.saveEntry(makeEntry({ id: "e2", month: "2026-05", status: "posted", type: "revenue", amountJpy: 100_000 }));
    const summary = await svc.getSummary("2026-05");
    expect(summary.entryCount).toBe(2);
    expect(summary.draftCount).toBe(1);
    expect(summary.revenue).toBe(100_000);
  });

  it("getSummary calculates profit correctly", async () => {
    await svc.saveEntry(makeEntry({ id: "e1", month: "2026-05", type: "revenue", status: "posted", amountJpy: 500_000 }));
    await svc.saveEntry(makeEntry({ id: "e2", month: "2026-05", type: "expense", status: "posted", amountJpy: 200_000 }));
    const summary = await svc.getSummary("2026-05");
    expect(summary.revenue).toBe(500_000);
    expect(summary.expenses).toBe(200_000);
    expect(summary.profit).toBe(300_000);
  });

  it("getSummary only aggregates entries for the requested month", async () => {
    await svc.saveEntry(makeEntry({ id: "e1", month: "2026-05", type: "revenue", status: "posted", amountJpy: 500_000 }));
    await svc.saveEntry(makeEntry({ id: "e2", month: "2026-06", type: "revenue", status: "posted", amountJpy: 999_999 }));
    const summary = await svc.getSummary("2026-05");
    expect(summary.revenue).toBe(500_000);
    expect(summary.entryCount).toBe(1);
  });

  // Boundary ───────────────────────────────────────────────────────────────

  it("saveEntry upserts when same id is saved twice", async () => {
    await svc.saveEntry(makeEntry({ description: "original" }));
    await svc.saveEntry(makeEntry({ description: "updated" }));
    expect(await svc.listEntries()).toHaveLength(1);
    expect((await svc.getEntry("entry-1"))?.description).toBe("updated");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MockReportingService tests  (pure zero-data stub — no dependencies)
// ─────────────────────────────────────────────────────────────────────────────

describe("MockReportingService", () => {
  let svc: MockReportingService;

  beforeEach(() => {
    svc = new MockReportingService();
  });

  it("getKPIs returns the requested month", async () => {
    const kpis = await svc.getKPIs("2026-05");
    expect(kpis.month).toBe("2026-05");
  });

  it("getKPIs returns a fully-formed ReportingKPIs object with numeric fields", async () => {
    const kpis = await svc.getKPIs("2026-05");
    // Verify every numeric KPI field exists and is a finite number.
    const numericFields: Array<keyof typeof kpis> = [
      "leadsTotal", "leadsWon", "leadsLost", "leadConversionRate",
      "proposalsTotal", "proposalsAccepted", "proposalWinRate",
      "outboundInvoicesTotal", "outboundInvoicesPaid", "outboundInvoicesOverdue",
      "invoiceCollectionRate", "totalOutstandingJpy",
      "totalRevenueJpy", "totalExpensesJpy", "netProfitJpy", "grossMarginPct",
      "expensesTotal", "expensesApproved", "expensesRejected",
      "activeVendors", "activeContracts", "vendorsWithMissingInvoice",
    ];
    for (const field of numericFields) {
      expect(typeof kpis[field]).toBe("number");
      expect(Number.isFinite(kpis[field] as number)).toBe(true);
    }
  });

  it("getKPIs returns zero-filled values (stub implementation)", async () => {
    const kpis = await svc.getKPIs("2026-05");
    expect(kpis.leadsTotal).toBe(0);
    expect(kpis.totalRevenueJpy).toBe(0);
    expect(kpis.netProfitJpy).toBe(0);
  });

  it("getKPIs accepts an arbitrary month string without throwing", async () => {
    await expect(svc.getKPIs("2099-12")).resolves.toBeDefined();
    await expect(svc.getKPIs("2000-01")).resolves.toBeDefined();
  });
});
