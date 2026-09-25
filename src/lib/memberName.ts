// Shared name-matching helpers for tying a Member DB record to its
// SharePoint contract folder — used by both the sync route (matching
// folder items to existing members) and the Members UI (matching a
// member row to its folder's files for "View Files").

// Extract a human-readable name from a SharePoint item name.
// Handles patterns like "01_Yamada_Taro.pdf", "Smith-John Contract 2024.pdf",
// subfolder names like "02_山田太郎", etc.
export function extractMemberName(rawName: string): string {
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

export function normaliseMemberName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}
