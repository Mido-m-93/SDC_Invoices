import { NextResponse } from "next/server";
import { google } from "googleapis";
import { JWT } from "google-auth-library";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const searchName  = searchParams.get("name")   ?? "";
  const searchMonth = searchParams.get("month")  ?? "";
  const folderId    = searchParams.get("folder") ?? ""; // directly list a folder by ID
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "";
  const clientEmail   = process.env.GOOGLE_CLIENT_EMAIL ?? "";
  const hasPrivateKey = !!(process.env.GOOGLE_PRIVATE_KEY);

  if (!rootFolderId) return NextResponse.json({ error: "GOOGLE_DRIVE_ROOT_FOLDER_ID not set" });
  if (!clientEmail)  return NextResponse.json({ error: "GOOGLE_CLIENT_EMAIL not set" });
  if (!hasPrivateKey) return NextResponse.json({ error: "GOOGLE_PRIVATE_KEY not set" });

  // Debug the key format before attempting auth
  const rawKey = process.env.GOOGLE_PRIVATE_KEY ?? "";
  const fence = "-".repeat(5);
  const pemRe = new RegExp(`${fence}BEGIN PRIVATE KEY${fence}[\\s\\S]*?${fence}END PRIVATE KEY${fence}`);
  const cleanedRaw = rawKey.replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const pemBlock = cleanedRaw.match(pemRe);
  const privateKey = pemBlock ? pemBlock[0] + "\n" : cleanedRaw.trim().replace(/^["']|["']$/g, "").trim();

  const keyDiag = {
    rawLength: rawKey.length,
    fixedLength: privateKey.length,
    startsCorrectly: privateKey.startsWith("-----BEGIN"),
    endsCorrectly: privateKey.trimEnd().endsWith("-----"),
    hasRealNewlines: privateKey.includes("\n"),
    lineCount: privateKey.split("\n").length,
  };

  if (!privateKey.startsWith("-----BEGIN")) {
    return NextResponse.json({ error: "Private key malformed", keyDiag });
  }

  try {
    const auth = new JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    const drive = google.drive({ version: "v3", auth });

    // Step 1: check what drives the service account belongs to
    let sharedDrives: unknown[] = [];
    try {
      const drivesRes = await drive.drives.list({
        pageSize: 20,
        fields: "drives(id,name)",
      });
      sharedDrives = drivesRes.data.drives ?? [];
    } catch (e) {
      sharedDrives = [{ error: String(e) }];
    }

    // Step 2: verify we can get the folder's own metadata
    let folderMeta: Record<string, unknown> = {};
    try {
      const meta = await drive.files.get({
        fileId: rootFolderId,
        fields: "id,name,mimeType,driveId",
        supportsAllDrives: true,
      });
      folderMeta = { id: meta.data.id, name: meta.data.name, mimeType: meta.data.mimeType, driveId: meta.data.driveId };
    } catch (e) {
      folderMeta = { error: String(e) };
    }

    // Step 3: list everything directly in root (subfolders + files)
    const rootRes = await drive.files.list({
      q: `'${rootFolderId}' in parents and trashed=false`,
      fields: "files(id,name,mimeType)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 100,
    });
    const rootItems = rootRes.data.files ?? [];

    // Step 4: for each subfolder found, list its contents too
    const subfolderContents: Record<string, unknown[]> = {};
    const subfolders = rootItems.filter(f => f.mimeType === "application/vnd.google-apps.folder");
    for (const sf of subfolders) {
      try {
        const sfRes = await drive.files.list({
          q: `'${sf.id}' in parents and trashed=false`,
          fields: "files(id,name,mimeType)",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageSize: 100,
        });
        subfolderContents[sf.name!] = sfRes.data.files ?? [];
      } catch (e) {
        subfolderContents[sf.name!] = [{ error: String(e) }];
      }
    }

    // Optional: search for a specific person across month folders
    let searchResult: unknown = null;
    if (searchName && searchMonth) {
      const normName = (s: string) => s.toLowerCase().replace(/[\s_\-.　]+/g, "");
      const payerNorm = normName(searchName);
      const [yearStr, monStr] = searchMonth.split("-");
      const monthNum = parseInt(monStr ?? "", 10);
      const FOLDER_MIME = "application/vnd.google-apps.folder";

      const matchesMonth = (name: string) =>
        !isNaN(monthNum) && !!yearStr &&
        name.includes(yearStr) &&
        (name.includes(`${monthNum}月`) || name.includes(`0${monthNum}月`.slice(-3)));

      // Find month folder in root, or inside year folders
      let monthFolder: { name: string; id: string } | null = null;
      const rootFolderItems = rootItems.filter(f => f.mimeType === FOLDER_MIME) as Array<{ id: string; name: string; mimeType: string }>;
      const directMatch = rootFolderItems.find(f => matchesMonth(f.name!));
      if (directMatch) {
        monthFolder = { name: directMatch.name!, id: directMatch.id! };
      } else {
        for (const yf of rootFolderItems.filter(f => /年度$/.test(f.name!))) {
          const yfRes = await drive.files.list({
            q: `'${yf.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: "files(id,name)", supportsAllDrives: true, includeItemsFromAllDrives: true,
          });
          const nested = (yfRes.data.files ?? []).find(f => matchesMonth(f.name!));
          if (nested) { monthFolder = { name: nested.name!, id: nested.id! }; break; }
        }
      }

      if (!monthFolder) {
        searchResult = { error: "No month folder found", searchMonth, payerNorm };
      } else {
        const mfRes = await drive.files.list({
          q: `'${monthFolder.id}' in parents and trashed=false`,
          fields: "files(id,name,mimeType)", supportsAllDrives: true, includeItemsFromAllDrives: true,
        });
        const mfFiles = mfRes.data.files ?? [];
        const directHit = mfFiles.find(f => f.mimeType !== FOLDER_MIME && normName(f.name!).includes(payerNorm));
        let subfoldersSearched: unknown[] = [];
        let subHit = null;
        for (const sf of mfFiles.filter(f => f.mimeType === FOLDER_MIME)) {
          const sfRes = await drive.files.list({
            q: `'${sf.id}' in parents and trashed=false`,
            fields: "files(id,name,mimeType)", supportsAllDrives: true, includeItemsFromAllDrives: true,
          });
          const sfFiles = sfRes.data.files ?? [];
          subfoldersSearched.push({ subfolder: sf.name, files: sfFiles.map(f => f.name) });
          const hit = sfFiles.find(f => f.mimeType !== FOLDER_MIME && normName(f.name!).includes(payerNorm));
          if (hit) { subHit = { foundIn: sf.name, file: hit.name }; break; }
        }
        searchResult = { monthFolder: monthFolder.name, payerNorm, directHit: directHit?.name ?? null, subfoldersSearched, subHit };
      }
    }

    // Direct folder lookup by ID
    let folderDump: unknown = null;
    if (folderId) {
      try {
        const res = await drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          fields: "files(id,name,mimeType)",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageSize: 100,
        });
        folderDump = { folderId, files: res.data.files ?? [] };
      } catch (e) {
        folderDump = { folderId, error: String(e) };
      }
    }

    return NextResponse.json({
      serviceAccount: clientEmail,
      rootFolderId,
      keyDiag,
      folderMeta,
      itemsInRoot: rootItems,
      subfolderContents,
      ...(searchResult !== null ? { searchResult } : {}),
      ...(folderDump !== null ? { folderDump } : {}),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), stack: (err as Error).stack }, { status: 500 });
  }
}
