// lib/services/stagedBudgetStore.ts — Budget Sync review-queue persistence facade
//
// Same split as stagedProposalStore.ts: file-based mock storage locally, real
// Supabase storage in production (USE_MOCK_STORAGE=false).

import "server-only";
import type { StagedBudgetRecord } from "@/types";
import * as mockStore from "./mock/fileStore";
import * as supabaseStore from "./real/SupabaseStagedBudgetStore";

function isMock(): boolean {
  return process.env.USE_MOCK_STORAGE !== "false";
}

export async function loadStagedBudgetRecords(): Promise<StagedBudgetRecord[]> {
  return isMock() ? mockStore.loadStagedBudgetRecords() : supabaseStore.loadStagedBudgetRecords();
}

export async function findStagedBudgetRecordByFileId(fileId: string): Promise<StagedBudgetRecord | null> {
  return isMock() ? mockStore.findStagedBudgetRecordByFileId(fileId) : supabaseStore.findStagedBudgetRecordByFileId(fileId);
}

export async function saveStagedBudgetRecord(record: StagedBudgetRecord): Promise<void> {
  return isMock() ? mockStore.saveStagedBudgetRecord(record) : supabaseStore.saveStagedBudgetRecord(record);
}
