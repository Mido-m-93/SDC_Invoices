// ─────────────────────────────────────────────────────────────────────────────
// lib/services/mock/index.ts — Mock service implementations
//
// All services return realistic data instantly.
// Replace with real implementations (lib/services/real/) when ready.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ISheetsService,
  IDriveService,
  IValidationService,
  IStorageService,
  IDashboardService,
  IVendorService,
  IContractService,
  IProposalService,
  IPaymentRecordService,
  IClientService,
  ILeadService,
  IMemberService,
  IAccountingService,
  IReportingService,
} from "../types";
import type {
  InvoiceSubmission,
  InvoiceValidationResult,
  ExtractedInvoiceFields,
  FiledDocument,
  ProcessingRun,
  ProcessingLog,
  AppConfig,
  Vendor,
  Contract,
  Proposal,
  PaymentRecord,
  Client,
  Lead,
  Member,
  AccountingEntry,
  AccountingEntryType,
  AccountingEntryStatus,
  ProfitAndLoss,
  AccountingSummary,
  ReportingKPIs,
  LeadStage,
  LeadSummary,
  MemberStatus,
} from "@/types";
import { safeValidationResult, parseCurrencyString } from "@/lib/validation/invoiceValidator";
import {
  loadUploadedSubmissions,
  saveUploadedSubmissions,
  saveValidationResult,
  loadValidationResults,
  saveFiledDocument,
  loadFiledDocuments,
  saveRun,
  loadRuns,
  appendLog,
  loadLogs,
  loadVendors,
  saveVendor,
  deleteVendor,
  loadContracts,
  saveContract,
  deleteContract,
  loadProposals,
  saveProposal,
  deleteProposal,
  loadPaymentRecords,
  savePaymentRecord,
  deletePaymentRecord,
  loadClients,
  saveClient,
  deleteClient,
  loadLeads,
  saveLead,
  deleteLead,
  loadMembers,
  saveMember,
  deleteMember,
} from "./fileStore";
import { DEFAULT_CONFIG } from "@/config/defaults";

const delay = (ms = 600) => new Promise((r) => setTimeout(r, ms));

// ── Mock Sheets Service ───────────────────────────────────────────────────────
export class MockSheetsService implements ISheetsService {
  async loadSubmissions(month: string): Promise<InvoiceSubmission[]> {
    await delay(300);
    return loadUploadedSubmissions(month);
  }
}

// ── Mock Drive Service ────────────────────────────────────────────────────────
export class MockDriveService implements IDriveService {
  async fetchAttachment(
    url: string
  ): Promise<{ filename: string; mimeType: string; data: Uint8Array } | null> {
    await delay(400);
    if (!url) return null;
    // Return a tiny fake PDF buffer
    return {
      filename: "mock_invoice.pdf",
      mimeType: "application/pdf",
      data: new Uint8Array([37, 80, 68, 70]), // "%PDF" magic bytes
    };
  }

  async uploadPdf(params: {
    folderId: string;
    filename: string;
    data: Uint8Array;
  }): Promise<{ fileId: string; webViewLink: string }> {
    await delay(700);
    const fileId = `mock-file-${Date.now()}`;
    return {
      fileId,
      webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
    };
  }

  async ensureMonthFolder(params: {
    rootFolderId: string;
    folderName: string;
  }): Promise<string> {
    await delay(200);
    return `mock-folder-${params.folderName}`;
  }

  async checkDuplicate(params: {
    folderId: string;
    filename: string;
  }): Promise<boolean> {
    await delay(100);
    // Simulate: the filed document for sub-005 already exists
    return params.filename.startsWith("中村 美咲_");
  }

  async listMonthFolders(_rootFolderId: string) {
    await delay(100);
    return [];
  }

  async listFilesInFolder(_folderId: string) {
    await delay(100);
    return [];
  }
}

// ── Mock Validation Service ───────────────────────────────────────────────────
export class MockValidationService implements IValidationService {
  async validate(submission: InvoiceSubmission): Promise<InvoiceValidationResult> {
    await delay(500);

    if (!submission.invoiceAttachment) {
      const base = safeValidationResult(submission, null, false, false);
      return enrichWithRisk(base, submission);
    }

    const claimedTotal = parseCurrencyString(submission.claimedAmountTaxIncluded) ?? 100000;
    const subtotal = Math.round(claimedTotal / 1.1);
    const taxAmount = claimedTotal - subtotal;

    const mockExtracted: ExtractedInvoiceFields = {
      invoiceDate: submission.closingMonth
        ? `${submission.closingMonth.slice(0, 7)}-01`
        : "2024-01-01",
      subtotal,
      taxAmount,
      total: claimedTotal,
      taxRate: 0.1,
      payeeName: submission.payerName,
      payerNameOnDoc: null,
      rawText: "消費税",
    };

    const base = safeValidationResult(submission, mockExtracted, true, false);
    return enrichWithRisk(base, submission);
  }

  async validateBatch(submissions: InvoiceSubmission[]): Promise<InvoiceValidationResult[]> {
    return Promise.all(submissions.map((s) => this.validate(s)));
  }
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function enrichWithRisk(
  result: InvoiceValidationResult,
  submission: InvoiceSubmission
): InvoiceValidationResult {
  const members = loadMembers();
  const payerNorm = normalizeForMatch(submission.payerName);
  const emailNorm = (submission.email ?? "").toLowerCase().trim();

  const member = members.find(
    (m) =>
      normalizeForMatch(m.displayName) === payerNorm ||
      (emailNorm && m.email.toLowerCase() === emailNorm)
  );

  const vendorMatched   = !!member;
  const contractMatched = member?.status === "active";

  let riskLevel: import("@/types").RiskLevel;
  let reviewerRecommendation: string;

  if (!vendorMatched) {
    riskLevel = "NEEDS_REVIEW";
    reviewerRecommendation = "Accounting Lead";
  } else if (!contractMatched) {
    riskLevel = "BLOCKED";
    reviewerRecommendation = "Accounting Lead";
  } else {
    riskLevel = result.statusCode === "READY" ? "OK" : "NEEDS_REVIEW";
    reviewerRecommendation = member!.department || "Accounting";
  }

  return { ...result, vendorMatched, contractMatched, riskLevel, reviewerRecommendation };
}

// ── Mock Storage Service ──────────────────────────────────────────────────────
export class MockStorageService implements IStorageService {
  private config: AppConfig = { ...DEFAULT_CONFIG };

  async saveSubmissions(submissions: InvoiceSubmission[], month: string): Promise<void> {
    saveUploadedSubmissions(submissions, month);
  }

  async clearAllSubmissions(): Promise<void> {
    if (typeof window !== "undefined") localStorage.removeItem("sdc_invoice_submissions");
  }

  async loadSubmissionsFromStore(month: string): Promise<InvoiceSubmission[]> {
    return loadUploadedSubmissions(month);
  }

  async listAvailableMonths(): Promise<string[]> {
    const all = loadUploadedSubmissions();
    const seen = new Set<string>();
    for (const s of all) {
      const m = s.closingMonth?.match(/(\d{4})[^\d](\d{1,2})/);
      if (m) seen.add(`${m[1]}-${m[2].padStart(2, "0")}`);
    }
    return Array.from(seen).sort().reverse();
  }

  async saveValidationResult(result: InvoiceValidationResult): Promise<void> {
    saveValidationResult(result);
  }

  async saveFiledDocument(doc: FiledDocument): Promise<void> {
    saveFiledDocument(doc);
  }

  async loadValidationResults(submissionIds: string[]): Promise<InvoiceValidationResult[]> {
    return loadValidationResults(submissionIds);
  }

  async loadFiledDocuments(submissionIds: string[]): Promise<FiledDocument[]> {
    return loadFiledDocuments(submissionIds);
  }

  async loadRuns(): Promise<ProcessingRun[]> {
    return loadRuns();
  }

  async saveRun(run: ProcessingRun): Promise<void> {
    saveRun(run);
  }

  async appendLog(log: ProcessingLog): Promise<void> {
    appendLog(log);
  }

  async loadLogs(runId: string): Promise<ProcessingLog[]> {
    return loadLogs(runId);
  }

  async loadConfig(): Promise<AppConfig> {
    await delay(100);
    return { ...this.config };
  }

  async saveConfig(config: AppConfig): Promise<void> {
    await delay(100);
    this.config = { ...config };
  }
}

// ── Mock Dashboard Service ────────────────────────────────────────────────────
export class MockDashboardService implements IDashboardService {
  async getStats(month: string) {
    await delay(300);
    const submissions = loadUploadedSubmissions(month);
    return {
      selectedMonth: month,
      totalRows: submissions.length,
      ready: 0,
      reviewRequired: 0,
      saved: 0,
      errors: 0,
      missingAttachment: submissions.filter((s) => !s.invoiceAttachment).length,
      alreadyProcessed: 0,
    };
  }
}

// ── Mock Vendor Service ───────────────────────────────────────────────────────
export class MockVendorService implements IVendorService {
  async listVendors(): Promise<Vendor[]> {
    return loadVendors();
  }
  async saveVendor(vendor: Vendor): Promise<void> {
    saveVendor(vendor);
  }
  async deleteVendor(id: string): Promise<void> {
    deleteVendor(id);
  }
}

// ── Mock Contract Service ─────────────────────────────────────────────────────
export class MockContractService implements IContractService {
  async listContracts(): Promise<Contract[]> {
    return loadContracts();
  }
  async saveContract(contract: Contract): Promise<void> {
    saveContract(contract);
  }
  async deleteContract(id: string): Promise<void> {
    deleteContract(id);
  }
}

// ── Mock Proposal Service ─────────────────────────────────────────────────────
export class MockProposalService implements IProposalService {
  async listProposals(): Promise<Proposal[]> {
    return loadProposals();
  }
  async saveProposal(proposal: Proposal): Promise<void> {
    saveProposal(proposal);
  }
  async deleteProposal(id: string): Promise<void> {
    deleteProposal(id);
  }
}

// ── Mock Payment Record Service ───────────────────────────────────────────────
export class MockPaymentRecordService implements IPaymentRecordService {
  async listPaymentRecords(): Promise<PaymentRecord[]> {
    return loadPaymentRecords();
  }
  async savePaymentRecord(record: PaymentRecord): Promise<void> {
    savePaymentRecord(record);
  }
  async deletePaymentRecord(id: string): Promise<void> {
    deletePaymentRecord(id);
  }
}

export class MockClientService implements IClientService {
  async listClients(): Promise<Client[]> { return loadClients(); }
  async getClient(id: string): Promise<Client | null> { return loadClients().find(c => c.id === id) ?? null; }
  async saveClient(client: Client): Promise<void> { saveClient(client); }
  async deleteClient(id: string): Promise<void> { deleteClient(id); }
}

export class MockLeadService implements ILeadService {
  async listLeads(filters?: { stage?: LeadStage }): Promise<Lead[]> {
    const all = loadLeads();
    if (filters?.stage) return all.filter(l => l.stage === filters.stage);
    return all;
  }
  async getLead(id: string): Promise<Lead | null> { return loadLeads().find(l => l.id === id) ?? null; }
  async saveLead(lead: Lead): Promise<void> { saveLead(lead); }
  async deleteLead(id: string): Promise<void> { deleteLead(id); }
  async updateStage(id: string, stage: LeadStage): Promise<void> {
    const all = loadLeads();
    const l = all.find(l => l.id === id);
    if (l) { l.stage = stage; saveLead(l); }
  }
  async getSummary(): Promise<LeadSummary> {
    const all = loadLeads();
    const byStage = {} as Record<LeadStage, number>;
    const stages: LeadStage[] = ["new","contacted","qualified","proposal_sent","negotiation","won","lost","on_hold"];
    for (const s of stages) byStage[s] = 0;
    for (const l of all) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
    return { total: all.length, byStage, totalPipelineValue: 0, currency: "JPY", wonThisMonth: byStage.won, lostThisMonth: byStage.lost };
  }
}

export class MockMemberService implements IMemberService {
  async listMembers(): Promise<Member[]> { return loadMembers(); }
  async getMember(id: string): Promise<Member | null> { return loadMembers().find(m => m.id === id) ?? null; }
  async saveMember(member: Member): Promise<void> { saveMember(member); }
  async deleteMember(id: string): Promise<void> { deleteMember(id); }
}

export class MockAccountingService implements IAccountingService {
  private store = new Map<string, AccountingEntry>();
  async listEntries(filters?: { month?: string; type?: AccountingEntryType; status?: AccountingEntryStatus }): Promise<AccountingEntry[]> {
    let all = Array.from(this.store.values());
    if (filters?.month) all = all.filter(e => e.month === filters.month);
    if (filters?.type) all = all.filter(e => e.type === filters.type);
    if (filters?.status) all = all.filter(e => e.status === filters.status);
    return all;
  }
  async getEntry(id: string): Promise<AccountingEntry | null> { return this.store.get(id) ?? null; }
  async saveEntry(entry: AccountingEntry): Promise<void> { this.store.set(entry.id, entry); }
  async deleteEntry(id: string): Promise<void> { this.store.delete(id); }
  async postEntry(id: string, actorName: string): Promise<void> {
    const e = this.store.get(id);
    if (!e) return;
    if (e.status !== "draft") {
      throw new Error(`Cannot post entry "${id}": status is "${e.status}", expected "draft".`);
    }
    this.store.set(id, { ...e, status: "posted", postedBy: actorName, postedAt: new Date().toISOString() });
  }
  async voidEntry(id: string, actorName: string): Promise<void> {
    const e = this.store.get(id);
    if (!e) return;
    if (e.status !== "posted") {
      throw new Error(`Cannot void entry "${id}": status is "${e.status}", expected "posted".`);
    }
    this.store.set(id, { ...e, status: "voided", postedBy: actorName });
  }
  async getProfitAndLoss(month: string): Promise<ProfitAndLoss> {
    return { month, totalRevenue: 0, totalExpenses: 0, grossProfit: 0, grossMarginPct: 0, byCategory: [], currency: "JPY" };
  }
  async getSummary(month: string): Promise<AccountingSummary> {
    return { month, revenue: 0, expenses: 0, profit: 0, entryCount: 0, draftCount: 0, currency: "JPY" };
  }
}

export class MockReportingService implements IReportingService {
  async getKPIs(month: string): Promise<ReportingKPIs> {
    return { month, leadsTotal: 0, leadsWon: 0, leadsLost: 0, leadConversionRate: 0, proposalsTotal: 0, proposalsAccepted: 0, proposalWinRate: 0, outboundInvoicesTotal: 0, outboundInvoicesPaid: 0, outboundInvoicesOverdue: 0, invoiceCollectionRate: 0, totalOutstandingJpy: 0, totalRevenueJpy: 0, totalExpensesJpy: 0, netProfitJpy: 0, grossMarginPct: 0, expensesTotal: 0, expensesApproved: 0, expensesRejected: 0, activeVendors: 0, activeContracts: 0, vendorsWithMissingInvoice: 0 };
  }
}
