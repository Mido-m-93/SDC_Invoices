// GET /api/drive/folders?month=2025-06
//
// Returns month subfolders (no ?month) or all files inside a specific month folder.
//
// Without ?month  → { folders: DriveFolder[] }
// With    ?month  → { folderId, files: DriveFile[] }

import { NextRequest, NextResponse } from "next/server";
import { getDriveService } from "@/lib/services";

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "root";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");

  try {
    const drive = getDriveService();

    if (!month) {
      const folders = await drive.listMonthFolders(ROOT_FOLDER_ID);
      return NextResponse.json({ folders });
    }

    // Find the specific month folder, then list its files
    const folders = await drive.listMonthFolders(ROOT_FOLDER_ID);
    const target  = folders.find(
      (f) => f.folderName === month || f.folderName.startsWith(month)
    );

    if (!target) {
      return NextResponse.json(
        { error: `No folder found for month: ${month}`, folders },
        { status: 404 }
      );
    }

    const files = await drive.listFilesInFolder(target.folderId);
    return NextResponse.json({ folderId: target.folderId, folderName: target.folderName, files });
  } catch (err) {
    console.error("[GET /api/drive/folders]", err);
    return NextResponse.json(
      { error: "Failed to list Drive folders", detail: String(err) },
      { status: 500 }
    );
  }
}
