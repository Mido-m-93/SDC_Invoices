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
