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
}

function readStore(): MockStore {
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
  };
  try {
    if (!fs.existsSync(STORE_PATH)) return empty;
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    // Handle legacy format where the file was a plain submissions array
    if (Array.isArray(parsed)) return { ...empty, submissions: parsed };
    const store = parsed as Partial<MockStore>;
    return {
      submissions:       store.submissions ?? [],
      validationResults: store.validationResults ?? {},
      filedDocuments:    store.filedDocuments ?? {},
      runs:              store.runs ?? [],
      logs:              store.logs ?? [],
      vendors:           store.vendors ?? [],
      contracts:         store.contracts ?? [],
      proposals:         store.proposals ?? [],
      paymentRecords:    store.paymentRecords ?? [],
      clients:           store.clients ?? [],
      leads:             store.leads ?? [],
      members:           store.members ?? [],
    };
  } catch {
    return empty;
  }
}

function writeStore(store: MockStore): void {
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

export function saveUploadedSubmissions(submissions: InvoiceSubmission[], month: string): void {
  const store = readStore();
  // Keep submissions from other months; replace only the target month.
  const others = store.submissions.filter((s) => deriveMonth(s) !== month);
  const next = [...others, ...submissions];
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
