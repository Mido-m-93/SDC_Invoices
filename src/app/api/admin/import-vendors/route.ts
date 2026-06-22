// POST /api/admin/import-vendors
// Reads the SharePoint contracts folder via Microsoft Graph API and
// bulk-creates vendor records from the 02_Vendor and 03_Member subfolders.

import { NextResponse } from "next/server";
import { getVendorService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import type { Vendor } from "@/types";

const TENANT_ID     = process.env.AZURE_TENANT_ID!;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;

const SITE_ID        = "robocp.sharepoint.com,7ae9ce72-ce6c-4a70-a666-7349dbb12f5f,381cff93-5911-482e-b30f-b879812250c4";
const CONTRACTS_PATH = "40_ExpandTogether/02_Functions/07_Legal/02_Contracts";

// Categories to import: [folder name, vendor type label]
const IMPORT_CATEGORIES: [string, string][] = [
  ["02_Vendor", "Vendor"],
  ["03_Member", "Member"],
];

async function getAccessToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    "client_credentials",
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = await res.json() as { access_token?: string; error_description?: string };
  if (!data.access_token) throw new Error(`Auth failed: ${data.error_description}`);
  return data.access_token;
}

async function graphGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function listSubfolders(token: string, categoryFolder: string): Promise<string[]> {
  const encodedPath = encodeURIComponent(`${CONTRACTS_PATH}/${categoryFolder}`)
    .replace(/%2F/g, "/");

  const path = `/sites/${SITE_ID}/drive/root:/${encodedPath}:/children?$select=name,folder&$top=200`;

  try {
    const data = await graphGet<{ value: Array<{ name: string; folder?: object }> }>(path, token);
    return (data.value ?? [])
      .filter((item) => item.folder !== undefined)
      .map((item) => item.name);
  } catch (err) {
    console.error(`[import-vendors] Could not list ${categoryFolder}:`, err);
    return [];
  }
}

export async function POST() {
  try {
    const token = await getAccessToken();
    const vendorService = getVendorService();

    // Get existing vendors to avoid duplicates
    const existing = await vendorService.listVendors();
    const existingNames = new Set(existing.map((v) => v.name.toLowerCase()));

    const results: { name: string; type: string; status: "added" | "skipped" }[] = [];

    for (const [folderName, type] of IMPORT_CATEGORIES) {
      const folders = await listSubfolders(token, folderName);

      for (const name of folders) {
        if (existingNames.has(name.toLowerCase())) {
          results.push({ name, type, status: "skipped" });
          continue;
        }

        const vendor: Vendor = {
          id: generateId(),
          name,
          aliases: [],
          taxRegistrationNumber: "",
          bankAccountLast4: "",
          defaultReviewer: "Accounting Lead",
          defaultProject: type === "Member" ? "Internal" : "",
          status: "active",
          createdAt: new Date().toISOString(),
        };

        await vendorService.saveVendor(vendor);
        existingNames.add(name.toLowerCase());
        results.push({ name, type, status: "added" });
      }
    }

    const added   = results.filter((r) => r.status === "added").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    return NextResponse.json({ success: true, added, skipped, results });
  } catch (err) {
    console.error("[import-vendors]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
