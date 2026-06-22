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
import type { Member } from "@/types";

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

async function listFolderChildren(token: string): Promise<DriveItem[]> {
  // Encode the folder path segments individually so spaces/underscores survive.
  const encodedFolder = SP_FOLDER.split("/").map(encodeURIComponent).join("/");
  const url = `https://graph.microsoft.com/v1.0/sites/${SP_SITE}/drive/root:/${encodedFolder}:/children?$top=200&$select=id,name,folder,file`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph folder listing failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { value?: DriveItem[] };
  return data.value ?? [];
}

// Extract a human-readable name from a SharePoint item name.
// Handles patterns like "01_Yamada_Taro.pdf", "Smith-John Contract 2024.pdf",
// subfolder names like "02_山田太郎", etc.
function extractMemberName(rawName: string): string {
  let name = rawName;
  // Strip file extension
  name = name.replace(/\.[^.]+$/, "");
  // Strip leading number + separator  (e.g. "01_", "02-", "3. ")
  name = name.replace(/^\d+\s*[_\-\.]\s*/, "");
  // Replace remaining underscores / hyphens with spaces
  name = name.replace(/[_\-]+/g, " ");
  // Remove common English suffixes (case-insensitive)
  name = name.replace(/\s+(contract|agreement|nda|signed|draft|final|v\d+|\d{4})(\s+.*)?$/gi, "");
  // Collapse multiple spaces
  name = name.replace(/\s+/g, " ").trim();
  return name;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

async function runSync(): Promise<{ added: number; skipped: number; total: number; names: string[] }> {
  const token   = await getAccessToken();
  const items   = await listFolderChildren(token);
  const service = getMemberService();
  const existing = await service.listMembers();

  const existingNames = new Set(existing.map((m) => normalise(m.displayName)));

  let added   = 0;
  let skipped = 0;
  const addedNames: string[] = [];

  for (const item of items) {
    const displayName = extractMemberName(item.name);
    if (!displayName) { skipped++; continue; }

    if (existingNames.has(normalise(displayName))) {
      skipped++;
      continue;
    }

    const now: string = new Date().toISOString();
    const newMember: Member = {
      id:           generateId("mbr"),
      displayName,
      email:        "",
      phone:        "",
      role:         "other",
      department:   "",
      employeeCode: "",
      joinDate:     now.slice(0, 10),
      status:       "active",
      avatarUrl:    "",
      notes:        `Auto-synced from SharePoint (${item.name})`,
      createdAt:    now,
      updatedAt:    now,
    };

    await service.saveMember(newMember);
    existingNames.add(normalise(displayName));
    added++;
    addedNames.push(displayName);
  }

  return { added, skipped, total: items.length, names: addedNames };
}

export async function GET() {
  try {
    const result = await runSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[GET /api/members/sync]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(_req: NextRequest) {
  try {
    const result = await runSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST /api/members/sync]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
