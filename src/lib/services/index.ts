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
  IProposalService,
  IPaymentRecordService,
  INotificationService,
  IReminderService,
  IExpenseService,
  IOutboundInvoiceService,
  ICloseChecklistService,
  ICloseService,
  IClientService,
  ILeadService,
  IMemberService,
  IAccountingService,
  IReportingService,
} from "./types";

import {
  MockSheetsService,
  MockDriveService,
  MockValidationService,
  MockStorageService,
  MockDashboardService,
  MockVendorService,
  MockContractService,
  MockProposalService,
  MockPaymentRecordService,
  MockClientService,
  MockLeadService,
  MockMemberService,
  MockAccountingService,
  MockReportingService,
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
import { MockCloseService } from "./mock/closeService";
import { SupabaseCloseService } from "./real/SupabaseCloseService";
import { SupabaseClientService } from "./real/SupabaseClientService";
import { SupabaseLeadService } from "./real/SupabaseLeadService";
import { SupabaseMemberService } from "./real/SupabaseMemberService";
import { SupabaseAccountingService } from "./real/SupabaseAccountingService";
import { SupabaseReportingService } from "./real/SupabaseReportingService";
import { SupabaseProposalService } from "./real/SupabaseProposalService";
import { SupabasePaymentRecordService } from "./real/SupabasePaymentRecordService";

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
let _proposal: IProposalService | undefined;
let _paymentRecord: IPaymentRecordService | undefined;
let _expense: IExpenseService | undefined;
let _outboundInvoice: IOutboundInvoiceService | undefined;
let _closeChecklist: ICloseChecklistService | undefined;
let _close: ICloseService | undefined;
let _client: IClientService | undefined;
let _lead: ILeadService | undefined;
let _member: IMemberService | undefined;
let _accounting: IAccountingService | undefined;
let _reporting: IReportingService | undefined;

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
function getValidationService(): IValidationService {
  if (!_validation) {
    const flag       = process.env.NEXT_PUBLIC_USE_MOCK_VALIDATION;
    const forceMock  = flag === "true";
    const forceReal  = flag === "false";
    const hasApiKey  = !!process.env.ANTHROPIC_API_KEY;
    // Use real validation when: explicitly opted in, OR API key present and not explicitly mocked
    const useReal = forceReal || (!forceMock && hasApiKey);
    _validation = useReal ? new RealValidationService() : new MockValidationService();
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
function getDashboardService(): IDashboardService {
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
// Webhook URL comes from Settings (app_config.teamsWebhookUrl, same source the
// Config page's "Test Send" button uses), falling back to TEAMS_WEBHOOK_URL for
// environments that still set it that way. Read fresh each call — not cached —
// so a Settings update takes effect without a redeploy.
export async function getNotificationService(): Promise<INotificationService> {
  if (isMock("NEXT_PUBLIC_USE_MOCK_NOTIFICATION")) {
    return new MockNotificationService();
  }
  const config = await getStorageService().loadConfig();
  const webhookUrl = config.teamsWebhookUrl || process.env.TEAMS_WEBHOOK_URL || "";
  if (!webhookUrl) {
    console.warn("[NotificationService] No Teams webhook configured (Settings > Teams Webhook, or TEAMS_WEBHOOK_URL) — falling back to mock");
    return new MockNotificationService();
  }
  return new TeamsNotificationService(webhookUrl);
}

// ── Reminder (Phase 7) ────────────────────────────────────────────────────────
export async function getReminderService(): Promise<IReminderService> {
  const notif = await getNotificationService();
  const paymentTermsDays = parseInt(process.env.PAYMENT_TERMS_DAYS ?? "30");
  return isMock("NEXT_PUBLIC_USE_MOCK_STORAGE")
    ? new MockReminderService(notif)
    : new SupabaseReminderService(notif, paymentTermsDays);
}

// ── Expense (Phase 8) ────────────────────────────────────────────────────────
// Mock mode permanently disabled — always use Supabase for expense claims.
export function getExpenseService(): IExpenseService {
  if (!_expense) _expense = new SupabaseExpenseService();
  return _expense;
}

// ── Outbound Invoice (Phase 9) ────────────────────────────────────────────────
export function getOutboundInvoiceService(): IOutboundInvoiceService {
  if (!_outboundInvoice) {
    _outboundInvoice = new SupabaseOutboundInvoiceService();
  }
  return _outboundInvoice;
}
export const getOutboundService = getOutboundInvoiceService;

// ── Monthly Close Checklist (Phase 10) ────────────────────────────────────────
export function getCloseChecklistService(): ICloseChecklistService {
  if (!_closeChecklist) {
    _closeChecklist = new SupabaseCloseChecklistService();
  }
  return _closeChecklist;
}

// ── Close service — lightweight checklist + bank sync (Phase 10) ──────────────
export function getCloseService(): ICloseService {
  if (!_close) {
    _close = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE")
      ? new MockCloseService()
      : new SupabaseCloseService();
  }
  return _close;
}

// ── Proposal ──────────────────────────────────────────────────────────────────
export function getProposalService(): IProposalService {
  if (!_proposal) {
    _proposal = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE")
      ? new MockProposalService()
      : new SupabaseProposalService();
  }
  return _proposal;
}

// ── Payment Record ────────────────────────────────────────────────────────────
export function getPaymentRecordService(): IPaymentRecordService {
  if (!_paymentRecord) {
    _paymentRecord = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE")
      ? new MockPaymentRecordService()
      : new SupabasePaymentRecordService();
  }
  return _paymentRecord;
}

// ── Client ────────────────────────────────────────────────────────────────────
export function getClientService(): IClientService {
  if (!_client) _client = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE") ? new MockClientService() : new SupabaseClientService();
  return _client;
}

// ── Lead ──────────────────────────────────────────────────────────────────────
export function getLeadService(): ILeadService {
  if (!_lead) _lead = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE") ? new MockLeadService() : new SupabaseLeadService();
  return _lead;
}

// ── Member ────────────────────────────────────────────────────────────────────
export function getMemberService(): IMemberService {
  if (!_member) _member = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE") ? new MockMemberService() : new SupabaseMemberService();
  return _member;
}

// ── Accounting ────────────────────────────────────────────────────────────────
export function getAccountingService(): IAccountingService {
  if (!_accounting) _accounting = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE") ? new MockAccountingService() : new SupabaseAccountingService();
  return _accounting;
}

// ── Reporting ─────────────────────────────────────────────────────────────────
export function getReportingService(): IReportingService {
  if (!_reporting) _reporting = isMock("NEXT_PUBLIC_USE_MOCK_STORAGE") ? new MockReportingService() : new SupabaseReportingService();
  return _reporting;
}

// ── Startup diagnostic (server-side only) ────────────────────────────────────
// Import and call this once in a server component or API route to log
// which services are running in real vs mock mode.
function logServiceModes(): void {
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
