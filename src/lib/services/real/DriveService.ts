import "server-only";
import { google } from "googleapis";
import type { IDriveService } from "../types";

export class RealDriveService implements IDriveService {
  private auth;

  constructor() {
    this.auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  }

  private async getDrive() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return google.drive({ version: "v3", auth: await this.auth.getClient() as any });
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
    const meta = await drive.files.get({ fileId, fields: "name,mimeType" });
    const res = await drive.files.get(
      { fileId, alt: "media" },
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
    });
    return (res.data.files?.length ?? 0) > 0;
  }

  async listMonthFolders(rootFolderId: string): Promise<import("@/types").DriveFolder[]> {
    const drive = await this.getDrive();
    const res = await drive.files.list({
      q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name)",
      orderBy: "name desc",
    });
    return (res.data.files ?? []).map((f) => ({
      folderId: f.id ?? "",
      folderName: f.name ?? "",
    }));
  }

  async listFilesInFolder(folderId: string): Promise<import("@/types").DriveFile[]> {
    const drive = await this.getDrive();
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "files(id,name,mimeType,webViewLink,createdTime)",
      orderBy: "name asc",
    });
    return (res.data.files ?? []).map((f) => ({
      fileId: f.id ?? "",
      fileName: f.name ?? "",
      mimeType: f.mimeType ?? "",
      webViewLink: f.webViewLink ?? "",
      createdAt: f.createdTime ?? undefined,
    }));
  }
}
