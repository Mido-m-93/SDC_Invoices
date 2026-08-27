// lib/services/stagedProposalStore.ts — Proposal Sync review-queue persistence facade
//
// Same split as pipelineSyncStore.ts: file-based mock storage locally, real
// Supabase storage in production (NEXT_PUBLIC_USE_MOCK_STORAGE=false).

import "server-only";
import type { StagedProposalRecord } from "@/types";
import * as mockStore from "./mock/fileStore";
import * as supabaseStore from "./real/SupabaseStagedProposalStore";

function isMock(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK_STORAGE !== "false";
}

export async function loadStagedProposalRecords(): Promise<StagedProposalRecord[]> {
  return isMock() ? mockStore.loadStagedProposalRecords() : supabaseStore.loadStagedProposalRecords();
}

export async function findStagedProposalRecordByFileId(fileId: string): Promise<StagedProposalRecord | null> {
  return isMock() ? mockStore.findStagedProposalRecordByFileId(fileId) : supabaseStore.findStagedProposalRecordByFileId(fileId);
}

export async function saveStagedProposalRecord(record: StagedProposalRecord): Promise<void> {
  return isMock() ? mockStore.saveStagedProposalRecord(record) : supabaseStore.saveStagedProposalRecord(record);
}
