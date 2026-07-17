// src/lib/services/sandbox/sandboxMfStore.ts
//
// Disk-backed store for the sandbox Money Forward routes
// (src/app/api/dev/sandbox-mf/**), following the same pattern as
// mock/fileStore.ts. Persisted so captured requests survive dev-server
// restarts (e.g. picking up a changed env var) — this is a request-shape
// test harness, not a production data store.

import "server-only";
import fs from "fs";
import path from "path";

const STORE_PATH = path.join(process.cwd(), "tmp-sandbox-mf-store.json");

export interface SandboxPartner {
  id: string;
  name: string;
}

export interface SandboxBilling {
  id: string;
  request: unknown;
  createdAt: string;
}

interface SandboxStore {
  partners: SandboxPartner[];
  billings: SandboxBilling[];
}

function readStore(): SandboxStore {
  try {
    if (!fs.existsSync(STORE_PATH)) return { partners: [], billings: [] };
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SandboxStore>;
    return { partners: parsed.partners ?? [], billings: parsed.billings ?? [] };
  } catch {
    return { partners: [], billings: [] };
  }
}

function writeStore(store: SandboxStore): void {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store), "utf-8");
  } catch (err) {
    console.error("[sandboxMfStore] Failed to write store to disk:", err);
  }
}

export function findSandboxPartnersByName(name: string): SandboxPartner[] {
  return readStore().partners.filter(
    (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
}

export function addSandboxPartner(partner: SandboxPartner): void {
  const store = readStore();
  store.partners.push(partner);
  writeStore(store);
}

export function addSandboxBilling(billing: SandboxBilling): void {
  const store = readStore();
  store.billings.push(billing);
  writeStore(store);
}

export function listSandboxBillings(): SandboxBilling[] {
  return readStore().billings;
}

export function getSandboxBillingById(id: string): SandboxBilling | undefined {
  return readStore().billings.find((b) => b.id === id);
}
