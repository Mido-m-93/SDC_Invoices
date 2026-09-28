// src/app/api/members/sync/route.ts
// Syncs members from a SharePoint folder.
// Each file or subfolder in the folder represents one member — the name is
// extracted from the item name.  Existing members (matched by normalised
// displayName) are left untouched so manual edits are preserved.
// New members are created with status "active".
//
// Called by:
//   • Vercel cron (GET /api/members/sync) — scheduled automatically
//   • Members page "Sync" button (POST /api/members/sync) — manual trigger

import { NextRequest, NextResponse } from "next/server";
import { getMemberService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { checkMemberBySharePointContracts } from "@/lib/services/real/SharePointContractService";
import { requireAuth } from "@/lib/auth-guard";
import { extractMemberName, normaliseMemberName } from "@/lib/memberName";
import type { Member } from "@/types";

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Each contract extraction is a Graph download + AI call — too slow to do for
// every member in one invocation without risking a Vercel function timeout.
// Cap it per run; members left over just get picked up on the next sync.
// Worst case (every extraction hits the timeout below) must stay comfortably
// under maxDuration: 3 * 12s = 36s, leaving headroom for token/list/DB overhead.
const MAX_CONTRACT_EXTRACTIONS_PER_RUN = 3;

const TENANT_ID     = process.env.AZURE_TENANT_ID!;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;

// Configurable via env — defaults to the RoboCo-op member contracts folder.
const SP_SITE   = process.env.MICROSOFT_MEMBER_SITE_PATH
  ?? "robocp.sharepoint.com:/sites/RoboCo-opSharedFiles:";
const SP_FOLDER = process.env.MICROSOFT_MEMBER_FOLDER_PATH
  ?? "40_ExpandTogether/02_Functions/07_Legal/02_Contracts/03_Member";

async function getAccessToken(): Promise<string> {
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
  const data = await res.json() as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`Token request failed: ${data.error} — ${data.error_description}`);
  }
  return data.access_token;
}

interface DriveItem {
  id: string;
  name: string;
  folder?: object;
  file?: object;
}

async function graphGet<T>(path: string, token: string): Promise<T> {
  const url = path.startsWith("https://") ? path : `https://graph.microsoft.com/v1.0${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

async function listFolderChildren(token: string): Promise<DriveItem[]> {
  // Step 1: resolve the site to get its stable ID
  const site = await graphGet<{ id: string }>(
    `/sites/${SP_SITE}`,
    token
  );

  // Step 2: list the folder using the resolved site ID
  const encodedFolder = SP_FOLDER.split("/").map(encodeURIComponent).join("/");
  const data = await graphGet<{ value?: DriveItem[] }>(
    `/sites/${site.id}/drive/root:/${encodedFolder}:/children?$top=200&$select=id,name,folder,file`,
    token
  );

  return data.value ?? [];
}

// Reads and AI-extracts the contract PDF once — non-fatal on failure, since a
// missing/unreadable contract shouldn't block the member record itself from syncing.
// Hard-timed out: a single hung Graph/AI call must not be able to consume the
// whole function's time budget and take the entire sync down with it.
const CONTRACT_EXTRACTION_TIMEOUT_MS = 12_000;

// A member whose contract already reads as expired gets re-checked against
// SharePoint periodically — a renewed contract (new file, or the same file
// edited in place) should get picked up without anyone having to notice the
// alert and manually re-trigger it. Cooldown keeps this from re-hitting the
// same still-genuinely-expired member (and burning an OpenAI call) every
// single day once nothing about their folder has changed.
const EXPIRED_RECHECK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function isMemberContractExpired(m: Member, now: Date): boolean {
  if (m.status !== "active" || !m.contractEnd) return false;
  const end = new Date(m.contractEnd).getTime();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return !Number.isNaN(end) && end < todayStart;
}

interface FetchContractFieldsResult {
  fields: {
    contractStart: string | null;
    contractEnd: string | null;
    contractedAmount: number | null;
    contractScope: string | null;
  } | null;
}

async function fetchContractFields(displayName: string): Promise<FetchContractFieldsResult> {
  try {
    const { contractInfo } = await Promise.race([
      checkMemberBySharePointContracts(displayName),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`contract extraction timed out after ${CONTRACT_EXTRACTION_TIMEOUT_MS}ms`)), CONTRACT_EXTRACTION_TIMEOUT_MS)
      ),
    ]);
    if (!contractInfo) return { fields: null };
    return {
      fields: {
        contractStart:    contractInfo.contractStart,
        contractEnd:      contractInfo.contractEnd,
        contractedAmount: contractInfo.contractedAmount,
        contractScope:    contractInfo.scope,
      },
    };
  } catch (err) {
    console.warn(`[members/sync] contract field extraction failed/timed out for "${displayName}":`, err);
    return { fields: null };
  }
}

async function runSync(retryFailed = false): Promise<{
  added: number; skipped: number; total: number; names: string[]; contractsBackfilled: number; stillMissing: number;
}> {
  const token   = await getAccessToken();
  const items   = await listFolderChildren(token);
  const service = getMemberService();
  const existing = await service.listMembers();

  const existingByName = new Map(existing.map((m) => [normaliseMemberName(m.displayName), m]));
  const stillMissing = existing.filter((m) => m.contractStart == null).length;

  let added               = 0;
  let skipped             = 0;
  let contractsBackfilled = 0;
  const addedNames: string[] = [];

  // In retry mode the contractSyncAttemptedAt gate is ignored, so without this
  // every run would just re-hit whichever ~3 members happen to sit first in
  // the folder's fixed listing order forever, never rotating to anyone else.
  // Process oldest-attempted-first instead so each run advances the queue.
  const orderedItems = retryFailed
    ? [...items].sort((a, b) => {
        const ta = existingByName.get(normaliseMemberName(extractMemberName(a.name)))?.contractSyncAttemptedAt ?? "";
        const tb = existingByName.get(normaliseMemberName(extractMemberName(b.name)))?.contractSyncAttemptedAt ?? "";
        return ta.localeCompare(tb);
      })
    : items;

  for (const item of orderedItems) {
    const displayName = extractMemberName(item.name);
    if (!displayName) { skipped++; continue; }

    const existingMember = existingByName.get(normaliseMemberName(displayName));

    if (existingMember) {
      skipped++;

      // Auto-synced members originally got joinDate set to the sync run date
      // (a placeholder, not a real hire date). Once a contract start date has
      // been extracted, it's the closest real date we have — correct joinDate
      // to match. Cheap (no Graph/AI call), so this runs every time, not just
      // for members still pending contract extraction.
      const isAutoSynced = existingMember.notes.startsWith("Auto-synced from SharePoint");
      if (isAutoSynced && existingMember.contractStart && existingMember.joinDate !== existingMember.contractStart) {
        existingMember.joinDate = existingMember.contractStart;
        await service.saveMember({
          ...existingMember,
          updatedAt: new Date().toISOString(),
        });
      }

      // Backfill contract fields for members synced before this was tracked —
      // capped per run so this route can't time out; leftovers pick up next sync.
      // Gate on contractSyncAttemptedAt (not contractStart) so a member whose
      // extraction genuinely fails isn't retried on every single future run —
      // since folder-listing order never changes, that would permanently jam
      // the front of the queue in front of everyone who hasn't been tried yet.
      const needsInitialExtraction = existingMember.contractStart == null
        && (retryFailed || existingMember.contractSyncAttemptedAt == null);

      // Separately, a member already flagged expired gets re-checked once the
      // cooldown has passed, regardless of contractStart — a renewal wouldn't
      // otherwise ever be picked up automatically.
      const lastAttempt = existingMember.contractSyncAttemptedAt ? new Date(existingMember.contractSyncAttemptedAt).getTime() : 0;
      const needsExpiredRecheck = isMemberContractExpired(existingMember, new Date())
        && Date.now() - lastAttempt > EXPIRED_RECHECK_COOLDOWN_MS;

      if ((needsInitialExtraction || needsExpiredRecheck) && contractsBackfilled < MAX_CONTRACT_EXTRACTIONS_PER_RUN) {
        contractsBackfilled++;
        const result = await fetchContractFields(displayName);
        await service.saveMember({
          ...existingMember,
          ...(result.fields ?? {}),
          ...(isAutoSynced && result.fields?.contractStart ? { joinDate: result.fields.contractStart } : {}),
          contractSyncAttemptedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      continue;
    }

    const now: string = new Date().toISOString();
    let fields: FetchContractFieldsResult["fields"] = null;
    let attemptedExtraction = false;
    if (contractsBackfilled < MAX_CONTRACT_EXTRACTIONS_PER_RUN) {
      contractsBackfilled++;
      attemptedExtraction = true;
      const result = await fetchContractFields(displayName);
      fields = result.fields;
    }
    const newMember: Member = {
      id:           generateId("mbr"),
      displayName,
      email:        "",
      phone:        "",
      role:         "other",
      department:   "",
      employeeCode: "",
      // Real contract start beats the sync run date whenever it's already
      // available; otherwise this gets corrected on a later run once the
      // contract has been extracted (see the existingMember branch above).
      joinDate:     fields?.contractStart ?? now.slice(0, 10),
      status:       "active",
      avatarUrl:    "",
      notes:        `Auto-synced from SharePoint (${item.name})`,
      createdAt:    now,
      updatedAt:    now,
      ...fields,
      ...(attemptedExtraction ? { contractSyncAttemptedAt: now } : {}),
    };

    await service.saveMember(newMember);
    existingByName.set(normaliseMemberName(displayName), newMember);
    added++;
    addedNames.push(displayName);
  }

  return { added, skipped, total: items.length, names: addedNames, contractsBackfilled, stillMissing };
}

export async function GET(req: NextRequest) {
  // Called by Vercel Cron, which signs the request with CRON_SECRET.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured on the server" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const retryFailed = req.nextUrl.searchParams.get("retry") === "true";
    const result = await runSync(retryFailed);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[GET /api/members/sync]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const retryFailed = req.nextUrl.searchParams.get("retry") === "true";
    const result = await runSync(retryFailed);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST /api/members/sync]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
