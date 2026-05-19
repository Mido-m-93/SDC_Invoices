// ─────────────────────────────────────────────────────────────────────────────
// lib/services/mock/mockData.ts — Realistic mock data for UI development
// Replace with real API calls in production.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  InvoiceSubmission,
  InvoiceValidationResult,
  FiledDocument,
  ProcessingRun,
  ProcessingLog,
  DashboardStats,
} from "@/types";

// ── Mock submissions ─────────────────────────────────────────────────────────
// Mutable in-place: MOCK_SUBMISSIONS contents are replaced after a CSV upload
// so that fetchInvoices() and dashboard stats see the same data.
export const MOCK_SUBMISSIONS: InvoiceSubmission[] = [];

export function replaceUploadedSubmissions(submissions: InvoiceSubmission[]): void {
  MOCK_SUBMISSIONS.splice(0, MOCK_SUBMISSIONS.length, ...submissions);
}

// ── Mock validation results ──────────────────────────────────────────────────
export const MOCK_VALIDATION_RESULTS: Record<string, InvoiceValidationResult> = {};

// ── Mock filed documents ─────────────────────────────────────────────────────
export const MOCK_FILED_DOCUMENTS: Record<string, FiledDocument> = {};

// ── Mock processing runs ─────────────────────────────────────────────────────
export const MOCK_RUNS: ProcessingRun[] = [];

// ── Mock logs ────────────────────────────────────────────────────────────────
export const MOCK_LOGS: ProcessingLog[] = [];

// ── Derived dashboard stats ──────────────────────────────────────────────────
export function getMockDashboardStats(month: string): DashboardStats {
  return {
    selectedMonth: month,
    totalRows: 0,
    ready: 0,
    reviewRequired: 0,
    saved: 0,
    errors: 0,
    missingAttachment: 0,
    alreadyProcessed: 0,
  };
}
