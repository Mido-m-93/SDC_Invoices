// lib/services/budgetSyncService.ts — Budget Sync review queue
//
// budgets.client_id is required, so a SharePoint budget whose extracted
// client name doesn't confidently match an existing client can't be saved
// outright. Those get staged here instead of silently dropped, so a human
// can pick (or create) the right client — same pattern as proposalSyncService.ts.

import "server-only";
import type { Budget, StagedBudgetRecord } from "@/types";
import { generateId } from "@/lib/utils";
import { getClientService, getBudgetService } from "@/lib/services";
import {
  loadStagedBudgetRecords,
  saveStagedBudgetRecord,
} from "@/lib/services/stagedBudgetStore";

export async function listStagedBudgetRecords(status: StagedBudgetRecord["status"] = "needs_review"): Promise<StagedBudgetRecord[]> {
  const all = await loadStagedBudgetRecords();
  return all.filter((r) => r.status === status).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Approve a staged record: link it to the given client (creating a new
 * client if `clientId` isn't provided), save the budget, and mark the
 * staged record committed.
 */
export async function approveStagedBudgetRecord(
  id: string,
  clientId?: string
): Promise<{ record: StagedBudgetRecord; budget: Budget }> {
  const record = (await loadStagedBudgetRecords()).find((r) => r.id === id);
  if (!record) throw new Error(`Staged budget record "${id}" not found`);
  if (record.status !== "needs_review") {
    throw new Error(`Record "${id}" already ${record.status}`);
  }

  const clientService = getClientService();
  const now = new Date().toISOString();

  let client = clientId ? await clientService.getClient(clientId) : null;
  if (!client) {
    client = {
      id: generateId("cli"),
      name: record.rawClientName || record.fileName,
      legalName: "",
      industry: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      address: "",
      country: "JP",
      taxRegistrationNumber: "",
      status: "prospect",
      notes: "Created from budget SharePoint sync review.",
      aliases: [],
      createdAt: now,
      updatedAt: now,
    };
    await clientService.saveClient(client);
  }

  const budget: Budget = {
    id: generateId("bud"),
    clientId: client.id,
    clientName: client.name,
    proposalId: undefined,
    projectName: record.projectName || record.fileName,
    budgetAmount: record.budgetAmount ?? 0,
    currency: record.currency,
    budgetDate: record.budgetDate ?? now.slice(0, 10),
    status: "draft",
    description: `Synced from SharePoint: ${record.fileName}`,
    folderUrl: undefined,
    createdAt: now,
  };
  await getBudgetService().saveBudget(budget);

  const updated: StagedBudgetRecord = {
    ...record,
    status: "approved",
    createdBudgetId: budget.id,
    updatedAt: now,
  };
  await saveStagedBudgetRecord(updated);

  return { record: updated, budget };
}

export async function rejectStagedBudgetRecord(id: string, reason?: string): Promise<StagedBudgetRecord> {
  const record = (await loadStagedBudgetRecords()).find((r) => r.id === id);
  if (!record) throw new Error(`Staged budget record "${id}" not found`);
  if (record.status !== "needs_review") {
    throw new Error(`Record "${id}" already ${record.status}`);
  }

  const updated: StagedBudgetRecord = {
    ...record,
    status: "rejected",
    reviewerComment: reason ?? null,
    updatedAt: new Date().toISOString(),
  };
  await saveStagedBudgetRecord(updated);
  return updated;
}
