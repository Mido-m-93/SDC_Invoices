// lib/services/proposalSyncService.ts — Proposal Sync review queue
//
// proposals.client_id is a NOT NULL foreign key into clients(id), so a
// SharePoint proposal whose extracted client name doesn't confidently match
// an existing client can't be saved at all. Those get staged here instead of
// silently dropped, so a human can pick (or create) the right client.

import "server-only";
import type { Proposal, StagedProposalRecord } from "@/types";
import { generateId } from "@/lib/utils";
import { getClientService, getProposalService } from "@/lib/services";
import {
  loadStagedProposalRecords,
  saveStagedProposalRecord,
} from "@/lib/services/stagedProposalStore";

export async function listStagedProposalRecords(status: StagedProposalRecord["status"] = "needs_review"): Promise<StagedProposalRecord[]> {
  const all = await loadStagedProposalRecords();
  return all.filter((r) => r.status === status).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Approve a staged record: link it to the given client (creating a new
 * client if `clientId` isn't provided), save the proposal, and mark the
 * staged record committed.
 */
export async function approveStagedProposalRecord(
  id: string,
  clientId?: string
): Promise<{ record: StagedProposalRecord; proposal: Proposal }> {
  const record = (await loadStagedProposalRecords()).find((r) => r.id === id);
  if (!record) throw new Error(`Staged proposal record "${id}" not found`);
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
      notes: "Created from proposal SharePoint sync review.",
      aliases: [],
      createdAt: now,
      updatedAt: now,
    };
    await clientService.saveClient(client);
  }

  const proposal: Proposal = {
    id: generateId("prop"),
    clientId: client.id,
    clientName: client.name,
    leadId: undefined,
    projectName: record.projectName || record.fileName,
    proposalDate: record.proposalDate ?? now.slice(0, 10),
    estimatedAmount: record.estimatedAmount ?? 0,
    currency: record.currency,
    description: `Synced from SharePoint: ${record.fileName}`,
    status: "submitted",
    contractId: undefined,
    folderUrl: undefined,
    createdAt: now,
  };
  await getProposalService().saveProposal(proposal);

  const updated: StagedProposalRecord = {
    ...record,
    status: "approved",
    createdProposalId: proposal.id,
    updatedAt: now,
  };
  await saveStagedProposalRecord(updated);

  return { record: updated, proposal };
}

export async function rejectStagedProposalRecord(id: string, reason?: string): Promise<StagedProposalRecord> {
  const record = (await loadStagedProposalRecords()).find((r) => r.id === id);
  if (!record) throw new Error(`Staged proposal record "${id}" not found`);
  if (record.status !== "needs_review") {
    throw new Error(`Record "${id}" already ${record.status}`);
  }

  const updated: StagedProposalRecord = {
    ...record,
    status: "rejected",
    reviewerComment: reason ?? null,
    updatedAt: new Date().toISOString(),
  };
  await saveStagedProposalRecord(updated);
  return updated;
}
