// ─────────────────────────────────────────────────────────────────────────────
// lib/api/client.ts — Browser-safe API helpers
//
// Client components must use these functions instead of importing from
// lib/services (which is server-only due to googleapis / Node.js builtins).
//
// Each function calls the corresponding Next.js API route via fetch.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  InvoiceSubmission,
  InvoiceValidationResult,
  FiledDocument,
  ProcessingRun,
  ProcessingLog,
  DashboardStats,
  AppConfig,
  ReminderSummary,
  ReminderGap,
  StaleReview,
  DueDateAlert,
  ReminderType,
} from "@/types";

// ── Base fetch helper ─────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...options,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `API ${options?.method ?? "GET"} ${path} failed (${res.status}): ${
          (body as { error?: string }).error ?? res.statusText
        }`
      );
    }
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after 30s: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Invoices ──────────────────────────────────────────────────────────────────

export async function fetchAvailableMonths(): Promise<string[]> {
  const data = await apiFetch<{ months: string[] }>("/api/invoices/months");
  return data.months;
}

export async function fetchInvoices(month: string): Promise<InvoiceSubmission[]> {
  const data = await apiFetch<{ submissions: InvoiceSubmission[] }>(
    `/api/invoices?month=${encodeURIComponent(month)}`
  );
  return data.submissions;
}

export async function validateInvoice(
  submission: InvoiceSubmission,
  validatedBy?: string
): Promise<InvoiceValidationResult> {
  const data = await apiFetch<{ results: InvoiceValidationResult[] }>(
    "/api/invoices/validate",
    {
      method: "POST",
      body: JSON.stringify({ submission, validatedBy }),
    }
  );
  return data.results[0];
}

export async function validateInvoiceBatch(
  submissions: InvoiceSubmission[],
  month?: string,
  validatedBy?: string
): Promise<InvoiceValidationResult[]> {
  const data = await apiFetch<{ results: InvoiceValidationResult[] }>(
    "/api/invoices/validate",
    {
      method: "POST",
      body: JSON.stringify({ submissions, month, validatedBy }),
    }
  );
  return data.results;
}

export async function approveInvoice(
  submissionId: string,
  approvedBy?: string
): Promise<InvoiceValidationResult> {
  const data = await apiFetch<{ result: InvoiceValidationResult }>(
    "/api/invoices/approve",
    {
      method: "POST",
      body: JSON.stringify({ submissionId, approvedBy }),
    }
  );
  return data.result;
}

export async function fileInvoice(
  validation: InvoiceValidationResult
): Promise<FiledDocument> {
  const data = await apiFetch<{ filedDocument: FiledDocument }>(
    "/api/invoices/file",
    {
      method: "POST",
      body: JSON.stringify({ validation }),
    }
  );
  return data.filedDocument;
}

export async function fileInvoiceBulk(
  validations: InvoiceValidationResult[]
): Promise<{
  filed: FiledDocument[];
  skipped: { submissionId: string; reason: string }[];
  errors: { submissionId: string; error: string }[];
  summary: { total: number; filed: number; skipped: number; errors: number };
}> {
  return apiFetch("/api/invoices/file/bulk", {
    method: "POST",
    body: JSON.stringify({ validations }),
  });
}

// ── Validation results & filed documents ─────────────────────────────────────
// These come from the storage API route

export async function fetchValidationResults(
  submissionIds: string[]
): Promise<InvoiceValidationResult[]> {
  const data = await apiFetch<{ results: InvoiceValidationResult[] }>(
    "/api/storage/validation-results",
    {
      method: "POST",
      body: JSON.stringify({ submissionIds }),
    }
  );
  return data.results;
}

export async function fetchFiledDocuments(
  submissionIds: string[]
): Promise<FiledDocument[]> {
  const data = await apiFetch<{ documents: FiledDocument[] }>(
    "/api/storage/filed-documents",
    {
      method: "POST",
      body: JSON.stringify({ submissionIds }),
    }
  );
  return data.documents;
}

// ── Dashboard stats ───────────────────────────────────────────────────────────

export async function fetchDashboardStats(month: string): Promise<DashboardStats> {
  return apiFetch<DashboardStats>(
    `/api/dashboard/stats?month=${encodeURIComponent(month)}`
  );
}

// ── Processing runs & logs ────────────────────────────────────────────────────

export async function fetchRuns(): Promise<ProcessingRun[]> {
  const data = await apiFetch<{ runs: ProcessingRun[] }>("/api/runs");
  return data.runs;
}

export async function fetchLogs(runId: string): Promise<ProcessingLog[]> {
  const data = await apiFetch<{ logs: ProcessingLog[] }>(
    `/api/logs?runId=${encodeURIComponent(runId)}`
  );
  return data.logs;
}

// ── Excel file upload ─────────────────────────────────────────────────────────

export async function uploadInvoiceExcel(
  file: File
): Promise<{ submissions: InvoiceSubmission[]; snapshotMonth: string; detectedHeaders: string[]; headerMapping: Record<string, string>; rawPreview: string }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/invoices/upload", { method: "POST", body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(`Upload failed (${res.status}): ${err.error ?? res.statusText}`);
  }
  return res.json() as Promise<{ submissions: InvoiceSubmission[]; snapshotMonth: string; detectedHeaders: string[]; headerMapping: Record<string, string>; rawPreview: string }>;
}

// ── App config ────────────────────────────────────────────────────────────────

export async function fetchConfig(): Promise<AppConfig> {
  return apiFetch<AppConfig>("/api/config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await apiFetch<void>("/api/config", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

// ── Phase 7: Reminders & Notifications ───────────────────────────────────────

export async function fetchReminderSummary(month: string): Promise<ReminderSummary> {
  return apiFetch<ReminderSummary>(`/api/reminders/summary?month=${encodeURIComponent(month)}`);
}

export async function sendReminders(
  month: string,
  type: ReminderType | "all"
): Promise<{ sent: number; failed: number; skipped: number }> {
  return apiFetch<{ sent: number; failed: number; skipped: number }>(
    "/api/reminders/send",
    { method: "POST", body: JSON.stringify({ month, type }) }
  );
}

export async function testNotification(): Promise<{ ok: boolean; message: string }> {
  return apiFetch<{ ok: boolean; message: string }>("/api/notifications/test", {
    method: "POST",
  });
}

export async function fetchReminderGaps(
  month: string,
  type: "missing_invoice" | "stale_review" | "due_date" = "missing_invoice"
): Promise<{ data: ReminderGap[] | StaleReview[] | DueDateAlert[] }> {
  return apiFetch(`/api/reminders/gaps?month=${encodeURIComponent(month)}&type=${type}`);
}
