// src/lib/services/real/BusinessContractSyncService.ts
// Syncs Client/Vendor/Partner contract PDFs from SharePoint into existing
// Contract records — the business-contract counterpart to the member-contract
// sync in SharePointContractService.ts. Uses the shared graphClient.ts helpers
// instead of hand-rolling Graph calls again (that's what graphClient.ts is for).

import "server-only";
import {
  DEFAULT_SITE_PATH,
  getGraphToken,
  resolveSiteId,
  listFolderChildren,
  listItemsByFolderId,
  downloadFileById,
  type GraphDriveItem,
} from "./graphClient";
import { extractContractFields, type ExtractedContractFields } from "../ai/contractExtractor";
import { similarity, AUTO_LINK_THRESHOLD } from "../ai/pipelineMatching";
import type { Contract, Vendor } from "@/types";

// Parent folder confirmed via GET /api/debug/sharepoint-folder?which=contracts.
// Subfolder names below are best-guess pending confirmation against the real
// site (see docs/PIPELINE_ARCHITECTURE.md) — override via env if they differ.
const CONTRACTS_PARENT = process.env.MICROSOFT_SALES_CONTRACTS_FOLDER_PATH
  ?? "40_ExpandTogether/02_Functions/07_Legal/02_Contracts";

const BUSINESS_SUBFOLDERS = (process.env.MICROSOFT_BUSINESS_CONTRACTS_FOLDERS ?? "01_Client,02_Vendor,04_Partner")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_EXTRACTIONS_PER_RUN = Number(process.env.CONTRACT_SYNC_MAX_EXTRACTIONS ?? 3);
const EXTRACTION_TIMEOUT_MS = 12_000;

function cleanFileName(rawName: string): string {
  return rawName
    .replace(/\.[^.]+$/, "")
    .replace(/^\d+\s*[_\-.]\s*/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+(contract|agreement|nda|signed|draft|final|v\d+|\d{4})(\s+.*)?$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function findPdf(siteId: string, token: string, item: GraphDriveItem): Promise<{ id: string; name: string } | null> {
  if (!item.isFolder) return item.name.toLowerCase().endsWith(".pdf") ? { id: item.id, name: item.name } : null;
  const children = await listItemsByFolderId(siteId, item.id, token);
  const pdf = children.find((c) => !c.isFolder && c.name.toLowerCase().endsWith(".pdf"));
  return pdf ? { id: pdf.id, name: pdf.name } : null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`extraction timed out after ${ms}ms`)), ms)),
  ]);
}

export interface BusinessContractSyncResult {
  total: number;
  matched: number;
  updated: number;
  skipped: number;
  extractionsRun: number;
  details: Array<{ folder: string; file: string; matchedContractId: string | null; updated: boolean; reason?: string }>;
}

/**
 * Scan the Client/Vendor/Partner SharePoint contract folders, fuzzy-match each
 * file to an existing Contract by name, and backfill dates/amount/scope from
 * the PDF for matched contracts that are missing that data. Never creates new
 * Contract records — matches only.
 */
export async function syncBusinessContracts(
  contracts: Contract[],
  vendors: Vendor[],
  saveContract: (c: Contract) => Promise<void>,
): Promise<BusinessContractSyncResult> {
  const token = await getGraphToken();
  const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);

  // Build the match candidate list: one entry per contract, keyed by whichever
  // display name it carries (client name for client contracts, vendor name for vendor contracts).
  const candidates = contracts
    .map((c) => ({
      contractId: c.id,
      name: c.clientName || vendors.find((v) => v.id === c.vendorId)?.name || "",
    }))
    .filter((c) => c.name);

  const details: BusinessContractSyncResult["details"] = [];
  let extractionsRun = 0;

  for (const folder of BUSINESS_SUBFOLDERS) {
    const folderPath = `${CONTRACTS_PARENT}/${folder}`;
    let items: GraphDriveItem[];
    try {
      items = await listFolderChildren(siteId, folderPath, token);
    } catch (err) {
      details.push({ folder, file: "(folder)", matchedContractId: null, updated: false, reason: `folder not accessible: ${String(err)}` });
      continue;
    }

    for (const item of items) {
      const pdf = await findPdf(siteId, token, item).catch(() => null);
      if (!pdf) {
        details.push({ folder, file: item.name, matchedContractId: null, updated: false, reason: "no PDF found" });
        continue;
      }

      const cleaned = cleanFileName(item.name);
      const ranked = candidates
        .map((c) => ({ ...c, score: similarity(cleaned, c.name) }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0];

      if (!best || best.score < AUTO_LINK_THRESHOLD) {
        details.push({ folder, file: item.name, matchedContractId: null, updated: false, reason: "no confident match" });
        continue;
      }

      const contract = contracts.find((c) => c.id === best.contractId)!;
      const alreadyHasData = !!(contract.startDate && contract.endDate && contract.expectedMonthlyAmount > 0);
      if (alreadyHasData) {
        details.push({ folder, file: item.name, matchedContractId: contract.id, updated: false, reason: "contract already populated" });
        continue;
      }

      if (extractionsRun >= MAX_EXTRACTIONS_PER_RUN) {
        details.push({ folder, file: item.name, matchedContractId: contract.id, updated: false, reason: "extraction cap reached this run" });
        continue;
      }

      extractionsRun++;
      let fields: ExtractedContractFields;
      try {
        const bytes = await downloadFileById(siteId, pdf.id, token);
        fields = await withTimeout(extractContractFields(bytes), EXTRACTION_TIMEOUT_MS);
      } catch (err) {
        details.push({ folder, file: item.name, matchedContractId: contract.id, updated: false, reason: `extraction failed: ${String(err)}` });
        continue;
      }

      const updated: Contract = {
        ...contract,
        startDate: contract.startDate || fields.contractStart || contract.startDate,
        endDate: contract.endDate || fields.contractEnd || contract.endDate,
        expectedMonthlyAmount: contract.expectedMonthlyAmount || fields.contractedAmount || contract.expectedMonthlyAmount,
        paymentTerms: contract.paymentTerms || fields.paymentTerms || contract.paymentTerms,
      };
      await saveContract(updated);
      details.push({ folder, file: item.name, matchedContractId: contract.id, updated: true });
    }
  }

  return {
    total: details.length,
    matched: details.filter((d) => d.matchedContractId).length,
    updated: details.filter((d) => d.updated).length,
    skipped: details.filter((d) => !d.updated).length,
    extractionsRun,
    details,
  };
}
