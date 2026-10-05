import "server-only";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import { Readable } from "stream";
import type { IDriveService } from "../types";

function parsePrivateKey(raw: string | undefined): string {
  if (!raw) return "";
  const cleaned = raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  // Extract just the PEM block, stripping any surrounding JSON noise (quotes, commas, etc.)
  const fence = "-".repeat(5);
  const pemRe = new RegExp(`${fence}BEGIN PRIVATE KEY${fence}[\\s\\S]*?${fence}END PRIVATE KEY${fence}`);
  const pem = cleaned.match(pemRe);
  return pem ? pem[0] + "\n" : cleaned.trim();
}

export class RealDriveService implements IDriveService {
  private getAuth() {
    return new JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: parsePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  }

  private async getDrive() {
    return google.drive({ version: "v3", auth: this.getAuth() });
  }

  async fetchAttachment(url: string) {
    const fileIdMatch =
      url.match(/\/d\/([a-zA-Z0-9_-]+)/) ??
      url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (!fileIdMatch) {
      console.warn("[DriveService] Cannot parse file ID from URL:", url);
      return null;
    }
    const fileId = fileIdMatch[1];
    const drive = await this.getDrive();
    const meta = await drive.files.get({ fileId, fields: "name,mimeType", supportsAllDrives: true });
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    return {
      filename: meta.data.name ?? "invoice.pdf",
      mimeType: meta.data.mimeType ?? "application/pdf",
      data: new Uint8Array(res.data as ArrayBuffer),
    };
  }

  async ensureMonthFolder({
    rootFolderId,
    folderName,
  }: {
    rootFolderId: string;
    folderName: string;
  }) {
    const drive = await this.getDrive();
    const FOLDER_MIME = "application/vnd.google-apps.folder";

    // folderName arrives pre-built (e.g. "2026年07月" or "2026-07"), but real
    // folders in this Drive carry extra suffixes ("支払い分", "分") and aren't
    // zero-padded ("4月", not "04月") — an exact-name match never hits, which
    // used to silently create a disconnected new folder every time instead of
    // filing into the month folder that already has everything else. Parse
    // year/month back out and search tolerantly, same as the duplicate-check
    // in /api/invoices/validate, before ever creating something new.
    const parsed =
      folderName.match(/^(\d{4})-(\d{1,2})$/) ??
      folderName.match(/^(\d{4})年(\d{1,2})月/);
    const yearStr = parsed?.[1];
    const monthStr = parsed?.[2]?.padStart(2, "0");

    if (yearStr && monthStr) {
      const monthNoPad = String(Number(monthStr));
      const candidates = [`${yearStr}年${monthNoPad}月`, `${yearStr}年${monthStr}月`, `${yearStr}-${monthStr}`];

      const findIn = async (parentId: string): Promise<string | null> => {
        const results = await Promise.all(candidates.map((name) =>
          drive.files.list({
            q: `name contains '${name}' and mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and trashed=false`,
            fields: "files(id,name)",
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            pageSize: 1,
          })
        ));
        for (const r of results) {
          const mf = r.data.files?.[0];
          if (mf?.id) return mf.id;
        }
        return null;
      };

      let found = await findIn(rootFolderId);
      if (!found) {
        // Older months may nest one level deeper, under a "YYYY年度" year folder.
        const yearFolders = await drive.files.list({
          q: `name contains '年度' and mimeType = '${FOLDER_MIME}' and '${rootFolderId}' in parents and trashed=false`,
          fields: "files(id,name)",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageSize: 20,
        });
        const matches = await Promise.all(
          (yearFolders.data.files ?? []).filter((f) => !!f.id).map((f) => findIn(f.id!))
        );
        found = matches.find((id) => id !== null) ?? null;
      }
      if (found) return found;

      // Genuinely nothing existing anywhere — create one directly under root,
      // using the non-zero-padded naming that matches real folders here.
      const created = await drive.files.create({
        requestBody: {
          name: `${yearStr}年${monthNoPad}月`,
          mimeType: FOLDER_MIME,
          parents: [rootFolderId],
        },
        fields: "id",
        supportsAllDrives: true,
      });
      return created.data.id!;
    }

    // Couldn't parse a year/month out of folderName at all — fall back to the
    // old literal exact-name behavior.
    const existing = await drive.files.list({
      q: `'${rootFolderId}' in parents and name='${folderName}' and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: "files(id,name)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    if (existing.data.files?.length) {
      return existing.data.files[0].id!;
    }
    const folder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: FOLDER_MIME,
        parents: [rootFolderId],
      },
      fields: "id",
      supportsAllDrives: true,
    });
    return folder.data.id!;
  }

  async uploadPdf({
    folderId,
    filename,
    data,
    mimeType = "application/pdf",
  }: {
    folderId: string;
    filename: string;
    data: Uint8Array;
    mimeType?: string;
  }) {
    const drive = await this.getDrive();
    const stream = Readable.from(Buffer.from(data));
    const res = await drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType, body: stream },
      fields: "id,webViewLink",
      supportsAllDrives: true,
    });
    return {
      fileId: res.data.id!,
      webViewLink: res.data.webViewLink ?? "",
    };
  }

  async checkDuplicate({
    folderId,
    filename,
  }: {
    folderId: string;
    filename: string;
  }) {
    const drive = await this.getDrive();
    const res = await drive.files.list({
      q: `'${folderId}' in parents and name='${filename}' and trashed=false`,
      fields: "files(id)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return (res.data.files?.length ?? 0) > 0;
  }

  async listMonthFolders(rootFolderId: string) {
    const drive = await this.getDrive();
    const res = await drive.files.list({
      q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name)",
      orderBy: "name desc",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return (res.data.files ?? []).map((f) => ({ folderId: f.id!, folderName: f.name! }));
  }

  async listFilesInFolder(folderId: string) {
    const drive = await this.getDrive();
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "files(id,name,mimeType,webViewLink)",
      orderBy: "name",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return (res.data.files ?? []).map((f) => ({
      fileId: f.id!,
      filename: f.name!,
      mimeType: f.mimeType ?? "application/octet-stream",
      webViewLink: f.webViewLink ?? "",
    }));
  }

  async downloadById(fileId: string): Promise<Uint8Array> {
    const drive = await this.getDrive();
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    return new Uint8Array(res.data as ArrayBuffer);
  }
}
