// lib/services/mock/fileStore.ts
// File-based persistence for all mock data.
// Survives Next.js hot module replacement because it writes to disk.

import fs from "fs";
import path from "path";
import type {
  InvoiceSubmission,
  InvoiceValidationResult,
  FiledDocument,
  ProcessingRun,
  ProcessingLog,
  Vendor,
  Contract,
  Proposal,
  PaymentRecord,
  Client,
  Lead,
  Member,
  ExpenseClaim,
  StagedPipelineRecord,
  PipelineSyncAuditEntry,
} from "@/types";
import { parseSnapshotMonth } from "@/lib/utils";

const STORE_PATH = path.join(process.cwd(), "tmp-invoice-store.json");

interface MockStore {
  submissions: InvoiceSubmission[];
  validationResults: Record<string, InvoiceValidationResult>;
  filedDocuments: Record<string, FiledDocument>;
  runs: ProcessingRun[];
  logs: ProcessingLog[];
  vendors: Vendor[];
  contracts: Contract[];
  proposals: Proposal[];
  paymentRecords: PaymentRecord[];
  clients: Client[];
  leads: Lead[];
  members: Member[];
  expenseClaims: ExpenseClaim[];
  stagedPipelineRecords: StagedPipelineRecord[];
  pipelineAuditLog: PipelineSyncAuditEntry[];
}

// ── Seed data (shown when each array is empty) ───────────────────────────────

const SEED_EXPENSES: ExpenseClaim[] = [];

const SEED_CLIENTS: Client[] = [
  { id: "cli-001", name: "SDC Japan",           legalName: "SDC Japan 株式会社",         industry: "Technology",     contactName: "山田 太郎",      contactEmail: "yamada@sdc-japan.co.jp",    contactPhone: "03-1234-5678", address: "東京都渋谷区恵比寿1-1-1", country: "JP", taxRegistrationNumber: "T1000000000001", status: "active",    notes: "Main invoice client",       createdAt: "2026-01-15T09:00:00.000Z", updatedAt: "2026-06-01T10:00:00.000Z" },
  { id: "cli-002", name: "Osaka Tech Partners", legalName: "大阪テックパートナーズ株式会社", industry: "IT Services",   contactName: "中村 花子",      contactEmail: "nakamura@otp.co.jp",        contactPhone: "06-9876-5432", address: "大阪府大阪市北区梅田2-2-2", country: "JP", taxRegistrationNumber: "T2000000000002", status: "active",    notes: "Quarterly retainer",        createdAt: "2026-02-01T09:00:00.000Z", updatedAt: "2026-06-10T09:00:00.000Z" },
  { id: "cli-003", name: "RoboCo-op Singapore", legalName: "RoboCo-op Pte. Ltd.",         industry: "Consulting",     contactName: "Lee Mei Ling",   contactEmail: "meilin@roboco-op.sg",       contactPhone: "+65-9000-0001", address: "1 Raffles Place, Singapore",  country: "SG", taxRegistrationNumber: "",            status: "active",    notes: "APAC expansion partner",    createdAt: "2026-03-10T09:00:00.000Z", updatedAt: "2026-05-20T11:00:00.000Z" },
  { id: "cli-004", name: "Kyoto Robotics Lab",  legalName: "京都ロボティクス研究所",        industry: "Research",       contactName: "田中 誠",        contactEmail: "tanaka@krl.kyoto.ac.jp",    contactPhone: "075-111-2222", address: "京都府京都市左京区3-3-3",  country: "JP", taxRegistrationNumber: "T3000000000003", status: "prospect",  notes: "Pilot project in progress",  createdAt: "2026-04-05T09:00:00.000Z", updatedAt: "2026-06-15T14:00:00.000Z" },
  { id: "cli-005", name: "Fukuoka Digital",     legalName: "福岡デジタル株式会社",          industry: "E-Commerce",     contactName: "佐藤 幸子",      contactEmail: "sato@fukuoka-digital.jp",   contactPhone: "092-555-0099", address: "福岡県福岡市博多区4-4-4",  country: "JP", taxRegistrationNumber: "T4000000000004", status: "prospect",  notes: "Intro meeting scheduled",   createdAt: "2026-05-20T09:00:00.000Z", updatedAt: "2026-06-28T09:00:00.000Z" },
  { id: "cli-006", name: "Legacy Corp",         legalName: "レガシー商事株式会社",           industry: "Manufacturing",  contactName: "高橋 一郎",      contactEmail: "takahashi@legacy.co.jp",   contactPhone: "03-0000-1111", address: "東京都千代田区5-5-5",     country: "JP", taxRegistrationNumber: "T5000000000005", status: "inactive",  notes: "Contract ended Mar 2026",   createdAt: "2025-06-01T09:00:00.000Z", updatedAt: "2026-03-31T17:00:00.000Z" },
];

const SEED_PROPOSALS: Proposal[] = [
  { id: "prop-001", clientId: "cli-001", clientName: "SDC Japan",           projectName: "SDC Japan システム開発支援 Phase 2",   proposalDate: "2026-06-01", estimatedAmount: 3200000, currency: "JPY", description: "Phase 2 of the SDC Japan system development support contract. Covers API integration, testing, and deployment.", status: "submitted", contractId: "", folderUrl: "", createdAt: "2026-06-01T09:00:00.000Z" },
  { id: "prop-002", clientId: "cli-004", clientName: "Kyoto Robotics Lab",  projectName: "京都ロボティクス AI パイロット",         proposalDate: "2026-06-15", estimatedAmount: 1800000, currency: "JPY", description: "Pilot AI integration project for Kyoto Robotics Lab. Includes data analysis, model training, and reporting dashboard.", status: "submitted", contractId: "", folderUrl: "", createdAt: "2026-06-15T10:00:00.000Z" },
  { id: "prop-003", clientId: "cli-002", clientName: "Osaka Tech Partners", projectName: "大阪テック クラウド移行支援",            proposalDate: "2026-05-10", estimatedAmount: 4500000, currency: "JPY", description: "Full cloud migration support for Osaka Tech Partners. AWS setup, CI/CD pipeline, monitoring.", status: "accepted",  contractId: "con-001", folderUrl: "", createdAt: "2026-05-10T09:00:00.000Z" },
  { id: "prop-004", clientId: "cli-003", clientName: "RoboCo-op Singapore", projectName: "RoboCo-op Singapore Onboarding",      proposalDate: "2026-04-20", estimatedAmount: 2100000, currency: "JPY", description: "Onboarding and setup for RoboCo-op Singapore entity. Legal, HR, and IT infrastructure.", status: "draft",     contractId: "", folderUrl: "", createdAt: "2026-04-20T09:00:00.000Z" },
  { id: "prop-005", clientId: "cli-006", clientName: "Legacy Corp",         projectName: "Legacy Corp DX Consultation",          proposalDate: "2026-02-01", estimatedAmount: 900000,  currency: "JPY", description: "Digital transformation consultation. Proposal rejected — budget constraints.", status: "rejected",  contractId: "", folderUrl: "", createdAt: "2026-02-01T09:00:00.000Z" },
  // ── TEST PIPELINE RECORD (Fukuoka Digital — matches lead-t01) ──
  { id: "prop-t01", clientId: "cli-005", clientName: "Fukuoka Digital",     projectName: "ECサイト全面リニューアル — フルスタック開発", proposalDate: "2026-07-10", estimatedAmount: 3800000, currency: "JPY", description: "Full-stack redevelopment of Fukuoka Digital's e-commerce platform. Scope: Next.js frontend, Node.js API, PostgreSQL migration, and 3-month delivery support.", status: "submitted", contractId: "", folderUrl: "", createdAt: "2026-07-10T09:00:00.000Z" },
];

const SEED_LEADS: Lead[] = [
  { id: "lead-001", clientId: "",        clientName: "Nagoya Motors",       contactName: "伊藤 健太",    contactEmail: "ito@nagoya-motors.co.jp",    source: "inbound",  stage: "new",           title: "自動車工場 IoT センサー導入",           estimatedValue: 5000000, currency: "JPY", probability: 20, expectedCloseDate: "2026-09-30", assignedTo: "Noraldeen Ahmed", proposalId: null, notes: "Inbound inquiry via website. Strong interest in IoT.", lostReason: "", createdAt: "2026-06-25T09:00:00.000Z", updatedAt: "2026-06-25T09:00:00.000Z" },
  { id: "lead-002", clientId: "",        clientName: "Sapporo Brewery Tech",contactName: "小林 美咲",   contactEmail: "kobayashi@sbt.co.jp",        source: "event",    stage: "new",           title: "醸造管理システム デジタル化",             estimatedValue: 2800000, currency: "JPY", probability: 25, expectedCloseDate: "2026-10-15", assignedTo: "Mariam Hassan",   proposalId: null, notes: "Met at TechConf Osaka. Interested in digitizing brewery ops.", lostReason: "", createdAt: "2026-06-28T10:00:00.000Z", updatedAt: "2026-06-28T10:00:00.000Z" },
  { id: "lead-003", clientId: "",        clientName: "Tokyo Logistics Co",  contactName: "渡辺 拓也",   contactEmail: "watanabe@tl-corp.co.jp",     source: "referral", stage: "contacted",     title: "物流ルート最適化 AI ソリューション",       estimatedValue: 7500000, currency: "JPY", probability: 40, expectedCloseDate: "2026-08-31", assignedTo: "Ahmad Khalil",    proposalId: null, notes: "Referral from SDC Japan. Had first call 2026-06-20.", lostReason: "", createdAt: "2026-06-10T09:00:00.000Z", updatedAt: "2026-06-20T15:00:00.000Z" },
  { id: "lead-004", clientId: "",        clientName: "Hiroshima Medical",   contactName: "松本 律子",   contactEmail: "matsumoto@hm-hospital.jp",   source: "outbound", stage: "contacted",     title: "病院 電子カルテ連携システム",             estimatedValue: 3200000, currency: "JPY", probability: 30, expectedCloseDate: "2026-09-15", assignedTo: "Naing Min Lwin",  proposalId: null, notes: "Cold outreach. Interested in EHR integration demo.", lostReason: "", createdAt: "2026-06-05T09:00:00.000Z", updatedAt: "2026-06-18T11:00:00.000Z" },
  { id: "lead-005", clientId: "cli-004", clientName: "Kyoto Robotics Lab",  contactName: "田中 誠",     contactEmail: "tanaka@krl.kyoto.ac.jp",    source: "referral", stage: "qualified",     title: "ロボットアーム 制御ソフトウェア開発",       estimatedValue: 6000000, currency: "JPY", probability: 60, expectedCloseDate: "2026-08-01", assignedTo: "Noraldeen Ahmed", proposalId: null, notes: "Existing client upgrade. Budget confirmed ¥6M.", lostReason: "", createdAt: "2026-05-20T09:00:00.000Z", updatedAt: "2026-06-22T09:00:00.000Z" },
  { id: "lead-006", clientId: "",        clientName: "Sendai Smart City",   contactName: "阿部 智子",   contactEmail: "abe@sendai-smartcity.jp",    source: "partner",  stage: "proposal_sent", title: "スマートシティ データ基盤 構築",           estimatedValue: 12000000,currency: "JPY", probability: 55, expectedCloseDate: "2026-07-31", assignedTo: "Mariam Hassan",   proposalId: "prop-001", notes: "Proposal submitted 2026-06-10. Follow up next week.", lostReason: "", createdAt: "2026-05-15T09:00:00.000Z", updatedAt: "2026-06-10T16:00:00.000Z" },
  { id: "lead-007", clientId: "cli-002", clientName: "Osaka Tech Partners", contactName: "中村 花子",   contactEmail: "nakamura@otp.co.jp",        source: "referral", stage: "negotiation",   title: "クラウド移行 Phase 2 エンジニアリング支援", estimatedValue: 4800000, currency: "JPY", probability: 80, expectedCloseDate: "2026-07-15", assignedTo: "Ahmad Khalil",    proposalId: "prop-003", notes: "Contract terms under review. Legal sign-off pending.", lostReason: "", createdAt: "2026-04-01T09:00:00.000Z", updatedAt: "2026-06-25T14:00:00.000Z" },
  { id: "lead-008", clientId: "cli-003", clientName: "RoboCo-op Singapore", contactName: "Lee Mei Ling", contactEmail: "meilin@roboco-op.sg",      source: "partner",  stage: "won",           title: "Singapore Entity Setup & IT Infrastructure", estimatedValue: 2100000, currency: "JPY", probability: 100,expectedCloseDate: "2026-06-01", assignedTo: "Noraldeen Ahmed", proposalId: "prop-003", notes: "Won. Contract signed 2026-06-01. Now in delivery.", lostReason: "", createdAt: "2026-03-01T09:00:00.000Z", updatedAt: "2026-06-01T09:00:00.000Z" },
  // ── TEST PIPELINE RECORD (Fukuoka Digital — proposal stage, ready to advance) ──
  { id: "lead-t01", clientId: "cli-005", clientName: "Fukuoka Digital",     contactName: "佐藤 幸子",   contactEmail: "sato@fukuoka-digital.jp",   source: "inbound",  stage: "proposal_sent", title: "ECサイト全面リニューアル — フルスタック開発", estimatedValue: 3800000, currency: "JPY", probability: 65, expectedCloseDate: "2026-08-31", assignedTo: "Mohamad Alayoubi", proposalId: "prop-t01", notes: "TEST RECORD — full pipeline chain. Proposal submitted, awaiting client decision.", lostReason: "", createdAt: "2026-07-01T09:00:00.000Z", updatedAt: "2026-07-10T09:00:00.000Z" },
];

const SEED_CONTRACTS: Contract[] = [
  // Completes the Osaka Tech Partners chain: prop-003 (accepted) → con-001
  { id: "con-001", vendorId: "", clientId: "cli-002", clientName: "Osaka Tech Partners", projectName: "大阪テック クラウド移行支援", startDate: "2026-07-01", endDate: "2027-06-30", expectedMonthlyAmount: 375000, currency: "JPY", paymentTerms: "月末締め翌月末払い", status: "active", proposalId: "prop-003", contractFolderUrl: "", createdAt: "2026-06-15T09:00:00.000Z" },
];

export function readStore(): MockStore {
  const empty: MockStore = {
    submissions: [],
    validationResults: {},
    filedDocuments: {},
    runs: [],
    logs: [],
    vendors: [],
    contracts: [],
    proposals: [],
    paymentRecords: [],
    clients: [],
    leads: [],
    members: [],
    expenseClaims: [],
    stagedPipelineRecords: [],
    pipelineAuditLog: [],
  };
  try {
    if (!fs.existsSync(STORE_PATH)) return { ...empty, expenseClaims: SEED_EXPENSES, clients: SEED_CLIENTS, proposals: SEED_PROPOSALS, leads: SEED_LEADS, contracts: SEED_CONTRACTS };
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    // Handle legacy format where the file was a plain submissions array
    if (Array.isArray(parsed)) return { ...empty, submissions: parsed, expenseClaims: SEED_EXPENSES, clients: SEED_CLIENTS, proposals: SEED_PROPOSALS, leads: SEED_LEADS, contracts: SEED_CONTRACTS };
    const store = parsed as Partial<MockStore>;
    return {
      submissions:       store.submissions ?? [],
      validationResults: store.validationResults ?? {},
      filedDocuments:    store.filedDocuments ?? {},
      runs:              store.runs ?? [],
      logs:              store.logs ?? [],
      vendors:           store.vendors ?? [],
      contracts:         store.contracts?.length    ? store.contracts    : SEED_CONTRACTS,
      proposals:         store.proposals?.length    ? store.proposals    : SEED_PROPOSALS,
      paymentRecords:    store.paymentRecords ?? [],
      clients:           store.clients?.length      ? store.clients      : SEED_CLIENTS,
      leads:             store.leads?.length        ? store.leads        : SEED_LEADS,
      members:           store.members ?? [],
      expenseClaims:     store.expenseClaims?.length ? store.expenseClaims : SEED_EXPENSES,
      stagedPipelineRecords: store.stagedPipelineRecords ?? [],
      pipelineAuditLog:      store.pipelineAuditLog ?? [],
    };
  } catch {
    return { ...empty, expenseClaims: SEED_EXPENSES, clients: SEED_CLIENTS, proposals: SEED_PROPOSALS, leads: SEED_LEADS, contracts: SEED_CONTRACTS };
  }
}

export function writeStore(store: MockStore): void {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store), "utf-8");
  } catch (err) {
    console.error("[fileStore] Failed to write store to disk:", err);
  }
}

// ── Submissions ───────────────────────────────────────────────────────────────

function deriveMonth(s: InvoiceSubmission): string {
  return parseSnapshotMonth(s.closingMonth);
}

function contentKey(s: InvoiceSubmission): string {
  return `${s.payerName}|${s.closingMonth}|${s.claimedAmountTaxIncluded ?? ""}`;
}

export function saveUploadedSubmissions(submissions: InvoiceSubmission[], month: string): void {
  const store = readStore();
  // Keep submissions from other months; replace only the target month.
  const others = store.submissions.filter((s) => deriveMonth(s) !== month);
  // Deduplicate incoming submissions by content fingerprint — same name+month+amount
  // is the same submission regardless of row number (prevents accumulation on re-upload).
  const seen = new Set<string>();
  const deduped = submissions.filter((s) => {
    const k = contentKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const next = [...others, ...deduped];
  const nextIds = new Set(next.map((s) => s.id));
  // Remove validation/filing only for IDs that no longer exist.
  for (const id of Object.keys(store.validationResults)) {
    if (!nextIds.has(id)) delete store.validationResults[id];
  }
  for (const id of Object.keys(store.filedDocuments)) {
    if (!nextIds.has(id)) delete store.filedDocuments[id];
  }
  store.submissions = next;
  writeStore(store);
}

export function loadUploadedSubmissions(month?: string): InvoiceSubmission[] {
  const all = readStore().submissions ?? [];
  if (!month) return all;
  return all.filter((s) => deriveMonth(s) === month);
}

// ── Validation results ────────────────────────────────────────────────────────

export function saveValidationResult(result: InvoiceValidationResult): void {
  const store = readStore();
  store.validationResults[result.submissionId] = result;
  writeStore(store);
}

export function loadValidationResults(submissionIds: string[]): InvoiceValidationResult[] {
  const map = readStore().validationResults;
  return submissionIds.map((id) => map[id]).filter(Boolean) as InvoiceValidationResult[];
}

// ── Filed documents ───────────────────────────────────────────────────────────

export function saveFiledDocument(doc: FiledDocument): void {
  const store = readStore();
  store.filedDocuments[doc.submissionId] = doc;
  writeStore(store);
}

export function loadFiledDocuments(submissionIds: string[]): FiledDocument[] {
  const map = readStore().filedDocuments;
  return submissionIds.map((id) => map[id]).filter(Boolean) as FiledDocument[];
}

// ── Processing runs ───────────────────────────────────────────────────────────

export function saveRun(run: ProcessingRun): void {
  const store = readStore();
  const idx = store.runs.findIndex((r) => r.id === run.id);
  if (idx >= 0) store.runs[idx] = run;
  else store.runs.unshift(run);
  writeStore(store);
}

export function loadRuns(): ProcessingRun[] {
  return readStore().runs;
}

// ── Processing logs ───────────────────────────────────────────────────────────

export function appendLog(log: ProcessingLog): void {
  const store = readStore();
  store.logs.push(log);
  writeStore(store);
}

export function loadLogs(runId: string): ProcessingLog[] {
  return readStore().logs.filter((l) => l.runId === runId);
}

// ── Vendors ───────────────────────────────────────────────────────────────────

export function loadVendors(): Vendor[] {
  return readStore().vendors;
}

export function saveVendor(vendor: Vendor): void {
  const store = readStore();
  const idx = store.vendors.findIndex((v) => v.id === vendor.id);
  if (idx >= 0) store.vendors[idx] = vendor;
  else store.vendors.push(vendor);
  writeStore(store);
}

export function deleteVendor(id: string): void {
  const store = readStore();
  store.vendors = store.vendors.filter((v) => v.id !== id);
  writeStore(store);
}

// ── Contracts ─────────────────────────────────────────────────────────────────

export function loadContracts(): Contract[] {
  return readStore().contracts;
}

export function saveContract(contract: Contract): void {
  const store = readStore();
  const idx = store.contracts.findIndex((c) => c.id === contract.id);
  if (idx >= 0) store.contracts[idx] = contract;
  else store.contracts.push(contract);
  writeStore(store);
}

export function deleteContract(id: string): void {
  const store = readStore();
  store.contracts = store.contracts.filter((c) => c.id !== id);
  writeStore(store);
}

// ── Proposals ─────────────────────────────────────────────────────────────────

export function loadProposals(): Proposal[] {
  return readStore().proposals;
}

export function saveProposal(proposal: Proposal): void {
  const store = readStore();
  const idx = store.proposals.findIndex((p) => p.id === proposal.id);
  if (idx >= 0) store.proposals[idx] = proposal;
  else store.proposals.push(proposal);
  writeStore(store);
}

export function deleteProposal(id: string): void {
  const store = readStore();
  store.proposals = store.proposals.filter((p) => p.id !== id);
  writeStore(store);
}

// ── Payment records ───────────────────────────────────────────────────────────

export function loadPaymentRecords(): PaymentRecord[] {
  return readStore().paymentRecords;
}

export function savePaymentRecord(record: PaymentRecord): void {
  const store = readStore();
  const idx = store.paymentRecords.findIndex((r) => r.id === record.id);
  if (idx >= 0) store.paymentRecords[idx] = record;
  else store.paymentRecords.push(record);
  writeStore(store);
}

export function deletePaymentRecord(id: string): void {
  const store = readStore();
  store.paymentRecords = store.paymentRecords.filter((r) => r.id !== id);
  writeStore(store);
}

// ── Clients ───────────────────────────────────────────────────────────────────

export function loadClients(): Client[] {
  return readStore().clients;
}

export function saveClient(client: Client): void {
  const store = readStore();
  const idx = store.clients.findIndex((c) => c.id === client.id);
  if (idx >= 0) store.clients[idx] = client;
  else store.clients.push(client);
  writeStore(store);
}

export function deleteClient(id: string): void {
  const store = readStore();
  store.clients = store.clients.filter((c) => c.id !== id);
  writeStore(store);
}

// ── Leads ─────────────────────────────────────────────────────────────────────

export function loadLeads(): Lead[] {
  return readStore().leads;
}

export function saveLead(lead: Lead): void {
  const store = readStore();
  const idx = store.leads.findIndex((l) => l.id === lead.id);
  if (idx >= 0) store.leads[idx] = lead;
  else store.leads.push(lead);
  writeStore(store);
}

export function deleteLead(id: string): void {
  const store = readStore();
  store.leads = store.leads.filter((l) => l.id !== id);
  writeStore(store);
}

// ── Members ───────────────────────────────────────────────────────────────────

export function loadMembers(): Member[] {
  return readStore().members;
}

export function saveMember(member: Member): void {
  const store = readStore();
  const idx = store.members.findIndex((m) => m.id === member.id);
  if (idx >= 0) store.members[idx] = member;
  else store.members.push(member);
  writeStore(store);
}

export function deleteMember(id: string): void {
  const store = readStore();
  store.members = store.members.filter((m) => m.id !== id);
  writeStore(store);
}

// ── Expense Claims ────────────────────────────────────────────────────────────

export function loadExpenseClaims(): ExpenseClaim[] {
  return readStore().expenseClaims;
}

export function saveExpenseClaim(claim: ExpenseClaim): void {
  const store = readStore();
  const idx = store.expenseClaims.findIndex((c) => c.id === claim.id);
  if (idx >= 0) store.expenseClaims[idx] = claim;
  else store.expenseClaims.push(claim);
  writeStore(store);
}

export function deleteExpenseClaim(id: string): void {
  const store = readStore();
  store.expenseClaims = store.expenseClaims.filter((c) => c.id !== id);
  writeStore(store);
}

export function updateExpenseClaimStatus(
  id: string,
  status: ExpenseClaim["status"],
  actorName: string,
  comment?: string,
): void {
  const store = readStore();
  const claim = store.expenseClaims.find((c) => c.id === id);
  if (!claim) return;
  const now = new Date().toISOString();
  claim.status = status;
  claim.updatedAt = now;
  if (status === "under_review" || status === "rejected") {
    claim.reviewedBy = actorName;
    claim.reviewedAt = now;
    if (comment) claim.reviewerComment = comment;
  }
  if (status === "approved") {
    claim.approvedBy = actorName;
    claim.approvedAt = now;
    claim.reviewedBy = actorName;
    claim.reviewedAt = now;
    if (comment) claim.reviewerComment = comment;
  }
  if (status === "paid") {
    claim.paidAt = now;
  }
  writeStore(store);
}

// ── Pipeline sync — staged records + audit log ────────────────────────────────

export function loadStagedPipelineRecords(): StagedPipelineRecord[] {
  return readStore().stagedPipelineRecords;
}

export function saveStagedPipelineRecord(record: StagedPipelineRecord): void {
  const store = readStore();
  const idx = store.stagedPipelineRecords.findIndex((r) => r.id === record.id);
  if (idx >= 0) store.stagedPipelineRecords[idx] = record;
  else store.stagedPipelineRecords.push(record);
  writeStore(store);
}

export function appendPipelineAuditEntry(entry: PipelineSyncAuditEntry): void {
  const store = readStore();
  store.pipelineAuditLog.push(entry);
  writeStore(store);
}

export function loadPipelineAuditLog(recordId?: string): PipelineSyncAuditEntry[] {
  const all = readStore().pipelineAuditLog;
  return recordId ? all.filter((e) => e.recordId === recordId) : all;
}
