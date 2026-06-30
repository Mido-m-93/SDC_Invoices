import "server-only";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
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
    const existing = await drive.files.list({
      q: `'${rootFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name)",
    });
    if (existing.data.files?.length) {
      return existing.data.files[0].id!;
    }
    const folder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [rootFolderId],
      },
      fields: "id",
    });
    return folder.data.id!;
  }

  async uploadPdf({
    folderId,
    filename,
    data,
  }: {
    folderId: string;
    filename: string;
    data: Uint8Array;
  }) {
    const drive = await this.getDrive();
    const { Readable } = await import("stream");
    const stream = Readable.from(Buffer.from(data));
    const res = await drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType: "application/pdf", body: stream },
      fields: "id,webViewLink",
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
