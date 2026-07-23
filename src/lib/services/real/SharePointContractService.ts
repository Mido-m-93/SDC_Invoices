// src/lib/services/real/SharePointContractService.ts
// Fetches invoice PDF attachments and member contracts from SharePoint via Graph API.

import "server-only";
import {
  extractContractFields,
  extractContractFieldsFromDocx,
  extractContractFieldsFromImage,
  hasAnyContractField,
  type ExtractedContractFields,
} from "@/lib/services/ai/contractExtractor";

const TENANT_ID     = process.env.AZURE_TENANT_ID!;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;

const SP_SITE             = process.env.MICROSOFT_MEMBER_SITE_PATH
  ?? "robocp.sharepoint.com:/sites/RoboCo-opSharedFiles:";
// Falls back to MICROSOFT_MEMBER_FOLDER_PATH too — /api/members/sync reads that
// same env var for the identical folder, so if only one of the two is actually
// configured in the deployment, both code paths still agree on where to look.
const SP_CONTRACTS_FOLDER = process.env.MICROSOFT_CONTRACTS_FOLDER_PATH
  ?? process.env.MICROSOFT_MEMBER_FOLDER_PATH
  ?? "40_ExpandTogether/02_Functions/07_Legal/02_Contracts/03_Member";

async function getToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    "client_credentials",
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Graph token request failed");
  return data.access_token;
}

async function graphGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Graph ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface ContractFile {
  id:     string;
  name:   string;
  siteId: string;
}

// ── Member name extraction (mirrors /api/members/sync logic) ─────────────────

function extractMemberName(rawName: string): string {
  let name = rawName;
  name = name.replace(/\.[^.]+$/, "");
  name = name.replace(/^\d+\s*[_\-\.]\s*/, "");
  name = name.replace(/[_\-]+/g, " ");
  name = name.replace(/\s+(contract|agreement|nda|signed|draft|final|v\d+|\d{4})(\s+.*)?$/gi, "");
  return name.replace(/\s+/g, " ").trim();
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function tokenizeForMatch(s: string): string[] {
  return s.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
}

export interface ContractCheckResult {
  matched: boolean;
  contractFileName: string | null;
  /** Extracted fields from the contract PDF. Null if not matched or PDF read failed. */
  contractInfo: ExtractedContractFields | null;
  /** Set when contractInfo is null because the PDF download/AI extraction step failed. */
  extractionError: string | null;
}

// Internal: list every item (both files AND subfolders) in the contracts folder.
// Members can be stored as direct PDF files OR as subfolders containing their PDF.
interface MemberItem {
  id: string;
  name: string;
  siteId: string;
  isFolder: boolean;
}

async function listAllMemberItems(token: string, siteId: string): Promise<MemberItem[]> {
  const folder = SP_CONTRACTS_FOLDER.split("/").map(encodeURIComponent).join("/");
  const data = await graphGet<{
    value?: Array<{ id: string; name: string; file?: object; folder?: object }>;
  }>(
    `/sites/${siteId}/drive/root:/${folder}:/children?$top=200&$select=id,name,file,folder`,
    token,
  );
  return (data.value ?? []).map((item) => ({
    id:       item.id,
    name:     item.name,
    siteId,
    isFolder: !!item.folder,
  }));
}

type ContractKind = "pdf" | "docx" | "image";
interface ContractCandidate {
  id: string;
  name: string;
  kind: ContractKind;
}

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".heic": "image/heic", ".webp": "image/webp",
};

function contractKindOf(name: string): ContractKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "docx";
  if (Object.keys(IMAGE_MIME).some((ext) => lower.endsWith(ext))) return "image";
  return null;
}

function imageMimeOf(name: string): string {
  const lower = name.toLowerCase();
  const ext = Object.keys(IMAGE_MIME).find((e) => lower.endsWith(e));
  return ext ? IMAGE_MIME[ext] : "image/jpeg";
}

// Internal: find every readable contract file inside a subfolder — a member's
// folder often has both a PDF and a Word version of the same contract. PDFs
// are ordered first (cheaper/more reliable via vision), Word docs as fallback.
async function findContractCandidatesInFolder(
  token: string,
  siteId: string,
  folderId: string,
): Promise<ContractCandidate[]> {
  const data = await graphGet<{ value?: Array<{ id: string; name: string; file?: object }> }>(
    `/sites/${siteId}/drive/items/${folderId}/children?$select=id,name,file`,
    token,
  );
  const candidates = (data.value ?? [])
    .filter((item) => item.file)
    .map((item) => ({ id: item.id, name: item.name, kind: contractKindOf(item.name) }))
    .filter((c): c is ContractCandidate => c.kind !== null);
  return orderCandidates(candidates);
}

// PDFs and images both go through vision (reliable); Word docs are text-only
// extraction (misses layout/handwriting), so try them last.
function orderCandidates(candidates: ContractCandidate[]): ContractCandidate[] {
  return [
    ...candidates.filter((c) => c.kind === "pdf"),
    ...candidates.filter((c) => c.kind === "image"),
    ...candidates.filter((c) => c.kind === "docx"),
  ];
}

// Last-resort fallback: some contract filenames embed an 8-digit YYYYMMDD
// date (e.g. "20241025_RCP_..."). Only recognized as a bounded, standalone
// 8-digit run (not part of a longer number) with a plausible year/month/day —
// not every filename has this, and we'd rather return nothing than guess
// wrong on a legal document's date.
function extractDateFromFilename(filename: string): string | null {
  const match = filename.match(/(?:^|[^0-9])(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month}-${day}`;
}

// Tries each candidate file in order (PDF first, then Word) until one yields
// at least one real field. Returns the last attempt's result if all fail, so
// the caller still gets a filename + error to report.
async function extractFromCandidates(
  siteId: string,
  candidates: ContractCandidate[],
): Promise<{ fileName: string; contractInfo: ExtractedContractFields | null; extractionError: string | null }> {
  let last: { fileName: string; contractInfo: ExtractedContractFields | null; extractionError: string | null } = {
    fileName: "", contractInfo: null, extractionError: "no readable contract file found",
  };

  for (const candidate of candidates) {
    try {
      const bytes = await downloadContractById(siteId, candidate.id);
      const contractInfo = candidate.kind === "pdf"
        ? await extractContractFields(bytes)
        : candidate.kind === "image"
        ? await extractContractFieldsFromImage(bytes, imageMimeOf(candidate.name), candidate.name)
        : await extractContractFieldsFromDocx(bytes);
      last = { fileName: candidate.name, contractInfo, extractionError: null };
      if (hasAnyContractField(contractInfo)) return last;
    } catch (err) {
      last = { fileName: candidate.name, contractInfo: null, extractionError: String(err) };
      console.warn(`[SP check] Contract read failed for ${candidate.name}:`, err);
    }
  }

  // Content-reading failed for every candidate — see if any filename at
  // least gives us a date to work with, rather than returning nothing.
  for (const candidate of candidates) {
    const filenameDate = extractDateFromFilename(candidate.name);
    if (filenameDate) {
      console.log(`[SP check] Falling back to filename date for "${candidate.name}": ${filenameDate}`);
      return {
        fileName: candidate.name,
        contractInfo: { memberName: null, contractedAmount: null, contractStart: filenameDate, contractEnd: null, paymentTerms: null, scope: null },
        extractionError: null,
      };
    }
  }

  return last;
}

/**
 * Check whether a submitter has a contract in the SharePoint contracts folder.
 * Primary/authoritative member registration check — call this before local store lookups.
 * Handles two folder structures:
 *   - Direct PDF: 03_Member/MemberName.pdf
 *   - Subfolder:  03_Member/MemberName/業務委託基本契約書_MemberName.pdf
 * When matched, also downloads the PDF and extracts contract fields (amount, dates, scope).
 * Throws on network/auth failure so the caller can catch and fall back gracefully.
 */
export async function checkMemberBySharePointContracts(
  submitterName: string,
): Promise<ContractCheckResult> {
  const token = await getToken();
  const site  = await graphGet<{ id: string }>(`/sites/${SP_SITE}`, token);
  const items = await listAllMemberItems(token, site.id);
  const submitterNorm = normalizeForMatch(submitterName);

  console.log(
    `[SP check] Looking for "${submitterName}" (norm: "${submitterNorm}") among ${items.length} items:`,
  );
  items.forEach((item) => {
    const ext = extractMemberName(item.name);
    console.log(
      `  [${item.isFolder ? "folder" : "file"}] raw="${item.name}" → norm="${normalizeForMatch(ext)}"`,
    );
  });

  let matchedItem: MemberItem | null = null;

  // Pass 1: exact or containment match on space-stripped strings
  for (const item of items) {
    const extractedNorm = normalizeForMatch(extractMemberName(item.name));

    if (extractedNorm === submitterNorm) {
      matchedItem = item;
      break;
    }
    const shorter = Math.min(extractedNorm.length, submitterNorm.length);
    if (
      shorter >= 5 &&
      (extractedNorm.includes(submitterNorm) || submitterNorm.includes(extractedNorm))
    ) {
      matchedItem = item;
      break;
    }
  }

  // Pass 2: token overlap — at least 2 shared tokens covering ≥50% of the shorter name
  if (!matchedItem) {
    const submitterTokens = tokenizeForMatch(submitterName);
    let bestScore = 0;
    for (const item of items) {
      const extractedName  = extractMemberName(item.name);
      const extractedTokens = tokenizeForMatch(extractedName);
      const shared = submitterTokens.filter((t) => extractedTokens.includes(t));
      if (shared.length < 2) continue;
      const overlapRatio = shared.length / Math.min(submitterTokens.length, extractedTokens.length);
      if (overlapRatio < 0.5) continue;
      if (shared.length > bestScore) {
        bestScore    = shared.length;
        matchedItem  = item;
      }
    }
    if (matchedItem) {
      console.log(
        `[SP check] Token overlap match for "${submitterName}": "${matchedItem.name}" (shared tokens: ${bestScore})`,
      );
    }
  }

  if (!matchedItem) {
    console.log(`[SP check] No match found for "${submitterName}"`);
    return { matched: false, contractFileName: null, contractInfo: null, extractionError: null };
  }

  // Resolve every readable candidate — either files inside a matched subfolder,
  // or (for a direct-file match) the file itself plus any sibling top-level
  // item with the same normalized name but a different extension (a member's
  // contract is sometimes stored as both a PDF and a Word doc side by side).
  let candidates: ContractCandidate[];
  if (matchedItem.isFolder) {
    candidates = await findContractCandidatesInFolder(token, matchedItem.siteId, matchedItem.id);
  } else {
    const matchedNorm = normalizeForMatch(extractMemberName(matchedItem.name));
    const siblings = items.filter(
      (i) => !i.isFolder && i.id !== matchedItem!.id && normalizeForMatch(extractMemberName(i.name)) === matchedNorm
    );
    const self = { id: matchedItem.id, name: matchedItem.name, kind: contractKindOf(matchedItem.name) };
    const all = [self, ...siblings.map((s) => ({ id: s.id, name: s.name, kind: contractKindOf(s.name) }))]
      .filter((c): c is ContractCandidate => c.kind !== null);
    candidates = orderCandidates(all);
  }

  if (candidates.length === 0) {
    // Folder/file exists but nothing readable inside — member is registered,
    // just no PDF/Word contract found.
    console.log(`[SP check] Matched "${submitterName}" but no readable contract file found`);
    return { matched: true, contractFileName: matchedItem.name, contractInfo: null, extractionError: null };
  }

  const { fileName, contractInfo, extractionError } = await extractFromCandidates(matchedItem.siteId, candidates);
  console.log(`[SP check] Contract read for "${submitterName}" (${fileName}):`, contractInfo ?? extractionError);

  return { matched: true, contractFileName: fileName, contractInfo, extractionError };
}

// List all PDF files in the member contracts SharePoint folder.
export async function listContractFiles(): Promise<ContractFile[]> {
  const token  = await getToken();
  const site   = await graphGet<{ id: string }>(`/sites/${SP_SITE}`, token);
  const folder = SP_CONTRACTS_FOLDER.split("/").map(encodeURIComponent).join("/");
  const data   = await graphGet<{ value?: Array<{ id: string; name: string; file?: object }> }>(
    `/sites/${site.id}/drive/root:/${folder}:/children?$top=200&$select=id,name,file`,
    token,
  );
  return (data.value ?? [])
    .filter((item) => item.file)
    .map((item) => ({ id: item.id, name: item.name, siteId: site.id }));
}

// Download a contract file by its Drive item ID.
export async function downloadContractById(siteId: string, fileId: string): Promise<Uint8Array> {
  const token = await getToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${fileId}/content`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Contract download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Download any SharePoint file by its public URL using the Graph shares endpoint.
// Works for MS Forms attachment URLs stored in invoiceAttachment.
export async function downloadSharePointFile(url: string): Promise<Uint8Array> {
  const token = await getToken();
  const encoded = Buffer.from(url)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/shares/u!${encoded}/driveItem/content`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`SharePoint file download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
