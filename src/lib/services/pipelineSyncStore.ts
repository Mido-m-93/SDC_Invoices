// lib/services/pipelineSyncStore.ts — Pipeline Sync persistence facade
//
// Staged records + audit log used to live only in the file-based mock store,
// which never persists on Vercel (read-only filesystem outside /tmp, and
// /tmp isn't guaranteed shared across function instances). This mirrors the
// NEXT_PUBLIC_USE_MOCK_STORAGE switch other services already use, so pipeline
// sync persists to Supabase wherever the rest of the app's storage is real.

import "server-only";
import type { StagedPipelineRecord, PipelineSyncAuditEntry } from "@/types";
import * as mockStore from "./mock/fileStore";
import * as supabaseStore from "./real/SupabasePipelineSyncStore";

function isMock(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK_STORAGE !== "false";
}

export async function loadStagedPipelineRecords(): Promise<StagedPipelineRecord[]> {
  return isMock() ? mockStore.loadStagedPipelineRecords() : supabaseStore.loadStagedPipelineRecords();
}

export async function saveStagedPipelineRecord(record: StagedPipelineRecord): Promise<void> {
  return isMock() ? mockStore.saveStagedPipelineRecord(record) : supabaseStore.saveStagedPipelineRecord(record);
}

export async function loadDeletedPipelineRecords(): Promise<StagedPipelineRecord[]> {
  return isMock() ? mockStore.loadDeletedPipelineRecords() : supabaseStore.loadDeletedPipelineRecords();
}

export async function softDeletePipelineRecord(id: string, deletedBy?: string): Promise<void> {
  return isMock() ? mockStore.softDeletePipelineRecord(id, deletedBy) : supabaseStore.softDeletePipelineRecord(id, deletedBy);
}

export async function restorePipelineRecordFromDelete(id: string): Promise<void> {
  return isMock() ? mockStore.restorePipelineRecordFromDelete(id) : supabaseStore.restorePipelineRecordFromDelete(id);
}

export async function appendPipelineAuditEntry(entry: PipelineSyncAuditEntry): Promise<void> {
  return isMock() ? mockStore.appendPipelineAuditEntry(entry) : supabaseStore.appendPipelineAuditEntry(entry);
}

export async function loadPipelineAuditLog(recordId?: string): Promise<PipelineSyncAuditEntry[]> {
  return isMock() ? mockStore.loadPipelineAuditLog(recordId) : supabaseStore.loadPipelineAuditLog(recordId);
}
