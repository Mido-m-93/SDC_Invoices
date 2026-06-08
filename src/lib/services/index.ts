// ─────────────────────────────────────────────────────────────────────────────
// lib/services/index.ts — Service factory
//
// Each service can be independently switched between mock and real using
// dedicated environment flags. Mock is the default for every service unless
// the corresponding flag is explicitly set to "false".
//
// Per-service flags (all default to mock):
//   NEXT_PUBLIC_USE_MOCK_SHEETS         = "false" → use RealSheetsService
//   NEXT_PUBLIC_USE_MOCK_DRIVE          = "false" → use RealDriveService      (not yet implemented)
//   NEXT_PUBLIC_USE_MOCK_VALIDATION     = "false" → use RealValidationService  (not yet implemented)
//   NEXT_PUBLIC_USE_MOCK_STORAGE        = "false" → use SupabaseStorageService (+ Vendor/Contract/Reminder)
//   NEXT_PUBLIC_USE_MOCK_DASHBOARD      = "false" → use RealDashboardService   (not yet implemented)
//   NEXT_PUBLIC_USE_MOCK_NOTIFICATION   = "false" → use TeamsNotificationService
//
// The legacy NEXT_PUBLIC_USE_MOCK flag is intentionally removed.
// Each service must be opted into real mode individually.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import type {
  ISheetsService,
  IDriveService,
  IValidationService,
  IStorageService,
  IDashboardService,
  IVendorService,
  IContractService,
  INotificationService,
  IReminderService,
  IExpenseService,
  IOutboundInvoiceService,
  ICloseChecklistService,
} from "./types";

import {
  MockSheetsService,
  MockDriveService,
  MockValidationService,
  MockStorageService,
  MockDashboardService,
  MockVendorService,
  MockContractService,
} from "./mock";
import { MockNotificationService } from "./mock/notificationService";
import { MockReminderService } from "./mock/reminderService";

import { RealSheetsService } from "./real/SheetsService";
import { MicrosoftSheetsService } from "./real/MicrosoftSheetsService";
import { SupabaseStorageService } from "./real/SupabaseStorageService";
import { SupabaseVendorService } from "./real/SupabaseVendorService";
import { SupabaseContractService } from "./real/SupabaseContractService";
import { TeamsNotificationService } from "./real/TeamsNotificationService";
import { SupabaseReminderService } from "./real/SupabaseReminderService";
import { RealValidationService } from "./real/RealValidationService";
import { RealDriveService } from "./real/DriveService";
import { SupabaseDashboardService } from "./real/SupabaseDashboardService";
import { SupabaseExpenseService } from "./real/SupabaseExpenseService";
import { SupabaseOutboundInvoiceService } from "./real/SupabaseOutboundInvoiceService";
import { SupabaseCloseChecklistService } from "./real/SupabaseCloseChecklistService";

// ── Per-service mock flag helper ─────────────────────────────────────────────
// Returns true (use mock) unless the flag is EXACTLY the string "false".
// Undefined, missing, "true", "1", or any other value → stays on mock.
function isMock(flagName: string): boolean {
  return process.env[flagName] !== "false";
}

// ── Singletons — each service is created once and cached ────────────────────
let _sheets: ISheetsService | undefined;
let _drive: IDriveService | undefined;
let _validation: IValidationService | undefined;
let _storage: IStorageService | undefined;
let _dashboard: IDashboardService | undefined;
let _vendor: IVendorService | undefined;
let _contract: IContractService | undefined;
let _notification: INotificationService | undefined;
let _reminder: IReminderService | undefined;
let _expense: IExpenseService | undefined;
let _outboundInvoice: IOutboundInvoiceService | undefined;
let _closeChecklist: ICloseChecklistService | undefined;

// ── Sheets ───────────────────────────────────────────────────────────────────
export function getSheetsService(): ISheetsService {
  if (!_sheets) {
    if (isMock("NEXT_PUBLIC_USE_MOCK_SHEETS")) {
      _sheets = new MockSheetsService();
    } else if (process.env.AZURE_TENANT_ID) {
      // Microsoft Forms → OneDrive Excel via Graph API
      _sheets = new MicrosoftSheetsService();
    } else {
      _sheets = new RealSheetsService();
    }
  }
  return _sheets;
}

// ── Drive ────────────────────────────────────────────────────────────────────
export function getDriveService(): IDriveService {
  if (!_drive) {
    _drive = isMock("NEXT_PUBLIC_USE_MOCK_DRIVE")
      ? new MockDriveService()
      : new RealDriveService();
  }
  return _drive;
}

// ── Validation ───────────────────────────────────────────────────────────────
export function getValidationService(): IValidationService {
  if (!_validation) {
    _validation = isMock("NEXT_PUBLIC_USE_MOCK_VALIDATION")
      ? new MockValidationService()
      : new RealValidationService();
  }
  return _validation;
}

// ── Storage (Supabase) ────────────────────────────────────────────────────────
export function getStorageService(): IStorageService {
  if (!_storage) {
    _storage = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE")
      ? new MockStorageService()
      : new SupabaseStorageService();
  }
  return _storage;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export function getDashboardService(): IDashboardService {
  if (!_dashboard) {
    _dashboard = isMock("NEXT_PUBLIC_USE_MOCK_DASHBOARD")
      ? new MockDashboardService()
      : new SupabaseDashboardService();
  }
  return _dashboard;
}

// ── Vendor ───────────────────────────────────────────────────────────────────
export function getVendorService(): IVendorService {
  if (!_vendor) {
    _vendor = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE")
      ? new MockVendorService()
      : new SupabaseVendorService();
  }
  return _vendor;
}

// ── Contract ──────────────────────────────────────────────────────────────────
export function getContractService(): IContractService {
  if (!_contract) {
    _contract = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE")
      ? new MockContractService()
      : new SupabaseContractService();
  }
  return _contract;
}

// ── Notification (Phase 7) ────────────────────────────────────────────────────
export function getNotificationService(): INotificationService {
  if (!_notification) {
    if (isMock("NEXT_PUBLIC_USE_MOCK_NOTIFICATION")) {
      _notification = new MockNotificationService();
    } else {
      const webhookUrl = process.env.TEAMS_WEBHOOK_URL ?? "";
      if (!webhookUrl) {
        console.warn("[NotificationService] TEAMS_WEBHOOK_URL not set — falling back to mock");
        _notification = new MockNotificationService();
      } else {
        _notification = new TeamsNotificationService(webhookUrl);
      }
    }
  }
  return _notification;
}

// ── Reminder (Phase 7) ────────────────────────────────────────────────────────
export function getReminderService(): IReminderService {
  if (!_reminder) {
    const notif = getNotificationService();
    const paymentTermsDays = parseInt(process.env.PAYMENT_TERMS_DAYS ?? "30");
    _reminder = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE")
      ? new MockReminderService(notif)
      : new SupabaseReminderService(notif, paymentTermsDays);
  }
  return _reminder;
}

// ── Expense (Phase 8) ────────────────────────────────────────────────────────
export function getExpenseService(): IExpenseService {
  if (!_expense) {
    _expense = new SupabaseExpenseService();
  }
  return _expense;
}

// ── Outbound Invoice (Phase 9) ────────────────────────────────────────────────
export function getOutboundInvoiceService(): IOutboundInvoiceService {
  if (!_outboundInvoice) {
    _outboundInvoice = new SupabaseOutboundInvoiceService();
  }
  return _outboundInvoice;
}

// ── Monthly Close Checklist (Phase 10) ────────────────────────────────────────
export function getCloseChecklistService(): ICloseChecklistService {
  if (!_closeChecklist) {
    _closeChecklist = new SupabaseCloseChecklistService();
  }
  return _closeChecklist;
}

// ── Startup diagnostic (server-side only) ────────────────────────────────────
// Import and call this once in a server component or API route to log
// which services are running in real vs mock mode.
export function logServiceModes(): void {
  if (typeof window !== "undefined") return; // guard: server only

  const services: [string, string][] = [
    ["Sheets",       "NEXT_PUBLIC_USE_MOCK_SHEETS"],
    ["Drive",        "NEXT_PUBLIC_USE_MOCK_DRIVE"],
    ["Validation",   "NEXT_PUBLIC_USE_MOCK_VALIDATION"],
    ["Storage",      "NEXT_PUBLIC_USE_MOCK_STORAGE"],
    ["Dashboard",    "NEXT_PUBLIC_USE_MOCK_DASHBOARD"],
    ["Notification", "NEXT_PUBLIC_USE_MOCK_NOTIFICATION"],
  ];

  console.log("\n[SDC Invoice Tool] Service modes:");
  for (const [name, flag] of services) {
    const mode = isMock(flag) ? "MOCK" : "REAL";
    console.log(`  ${name.padEnd(12)} → ${mode}`);
  }
  console.log("");
}
