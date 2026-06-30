// src/app/api/invoices/validate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStorageService, getMemberService } from "@/lib/services";
import { RealValidationService } from "@/lib/services/real/RealValidationService";
import { generateId, parseSnapshotMonth } from "@/lib/utils";
import type { InvoiceSubmission, ProcessingRun, ProcessingLog, Member } from "@/types";
import { matchSubmissionToMember } from "@/lib/services/ai/matchingService";
import { enrichWithRisk } from "@/lib/services/riskEnrichment";
import { checkMemberBySharePointContracts } from "@/lib/services/real/SharePointContractService";
import { extractFromPdf } from "@/lib/services/ai/pdfExtractor";

// ── Local member name matching (mirrors SharePointContractService token logic) ──
function normName(s: string) { return s.toLowerCase().replace(/\s+/g, ""); }
function tokenize(s: string) { return s.toLowerCase().split(/\s+/).filter(t => t.length > 1); }

function matchMemberByName(submitterName: string, members: Member[]): Member | null {
  const subNorm   = normName(submitterName);
  const subTokens = tokenize(submitterName);

  // Pass 1: exact or containment
  for (const m of members) {
    const mNorm = normName(m.displayName);
    if (mNorm === subNorm) return m;
    const shorter = Math.min(mNorm.length, subNorm.length);
    if (shorter >= 5 && (mNorm.includes(subNorm) || subNorm.includes(mNorm))) return m;
  }

  // Pass 2: token overlap — ≥2 shared tokens covering ≥50% of the shorter name
  let best: Member | null = null;
  let bestScore = 0;
  for (const m of members) {
    const mTokens = tokenize(m.displayName);
    const shared  = subTokens.filter(t => mTokens.includes(t));
    if (shared.length < 2) continue;
    const ratio = shared.length / Math.min(subTokens.length, mTokens.length);
    if (ratio < 0.5) continue;
    if (shared.length > bestScore) { bestScore = shared.length; best = m; }
  }
  return best;
}

export const dynamic = 'force-dynamic';

/**
 * POST /api/invoices/validate
 * Body: { submission: InvoiceSubmission } | { submissions: InvoiceSubmission[] }
 * Validates one or more invoices, persists results, and records a processing run + logs.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { submission, submissions, month, validatedBy, allMonthSubmissions } = body as {
    submission?: InvoiceSubmission;
    submissions?: InvoiceSubmission[];
    month?: string;
    validatedBy?: string;
    allMonthSubmissions?: InvoiceSubmission[];
  };

  const targets: InvoiceSubmission[] = submissions ?? (submission ? [submission] : []);

  if (!submission && !submissions) {
    return NextResponse.json(
      { error: "Provide 'submission' or 'submissions' in body" },
      { status: 400 }
    );
  }

  if (targets.length === 0) {
    return NextResponse.json({ count: 0, results: [] });
  }

  const runId = generateId();
  const startedAt = new Date().toISOString();
  const storageSvc = getStorageService();

  // Create run record as RUNNING
  const run: ProcessingRun = {
    id: runId,
    month: month ?? targets[0]?.closingMonth ?? "unknown",
    startedAt,
    completedAt: null,
    totalRows: targets.length,
    ready: 0,
    reviewRequired: 0,
    saved: 0,
    errors: 0,
    status: "RUNNING",
  };
  await storageSvc.saveRun(run);

  try {
    // Always use the real validation service here — mock would fabricate PDF totals
    // from the form amount, making Stage 1 always pass regardless of PDF content.
    const baseResults = await new RealValidationService().validateBatch(targets);

    // ── Checks 1+2+3 run in parallel ─────────────────────────────────────────────
    //
    //  Check 1 — Invoice PDF ↔ Form data  (already done by validationSvc above;
    //             amountMatchesSheet / invoiceDateFound / taxIncluded etc. capture this)
    //
    //  Check 2 — Contractor registration: submitter name vs SharePoint contracts folder
    //
    //  Check 3 — Google Drive: has this invoice already been filed?
    //
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "";
    console.log(`[Drive check] GOOGLE_DRIVE_ROOT_FOLDER_ID="${rootFolderId}"`);

    // Check 0: within-store duplicate — same payer already has a row for the same month
    const allStoredForMonth = await (async () => {
      try {
        const m = parseSnapshotMonth(targets[0]?.closingMonth);
        if (m === "unknown") return [];
        const all = await storageSvc.loadSubmissionsFromStore(m);
        // Deduplicate by row number — prevents re-load of the same spreadsheet row from being counted twice
        const seen = new Set<string>();
        return all.filter((s) => {
          const k = `${s.submissionRowNumber}|${s.closingMonth}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      } catch { return []; }
    })();

    const [driveChecks, members] = await Promise.all([
      // Check 3: Google Drive filing lookup — uses Drive API directly (bypasses mock singleton)
      Promise.all(
        targets.map(async (sub, idx) => {
          if (!rootFolderId) return null;
          if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) return null;
          try {
            const { google } = await import("googleapis");
            const { JWT }    = await import("google-auth-library");

            const fence    = "-".repeat(5);
            const pemRe    = new RegExp(`${fence}BEGIN PRIVATE KEY${fence}[\\s\\S]*?${fence}END PRIVATE KEY${fence}`);
            const rawKey   = process.env.GOOGLE_PRIVATE_KEY ?? "";
            const cleanKey = rawKey.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            const pemBlock = cleanKey.match(pemRe);
            const pk       = pemBlock ? pemBlock[0] + "\n" : cleanKey.trim();

            const auth  = new JWT({ email: process.env.GOOGLE_CLIENT_EMAIL, key: pk, scopes: ["https://www.googleapis.com/auth/drive"] });
            const drive = google.drive({ version: "v3", auth });

            const normName = (s: string) => s.toLowerCase().replace(/[\s_\-.　]+/g, "");
            const isEmail  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sub.payerName.trim());

            // If payerName is an email, use the PDF-extracted payee name instead
            const pdfPayeeName = baseResults[idx]?.extractedFields?.memberName ?? null;
            if (isEmail && !pdfPayeeName) {
              console.log(`[Drive check] "${sub.payerName}" is an email with no PDF payee name — cannot verify`);
              return { cannotVerify: true, reason: "payerName is an email address and no name was found in the invoice PDF" };
            }
            const searchName = isEmail ? pdfPayeeName! : sub.payerName;
            const payerNorm  = normName(searchName);
            const FOLDER_MIME = "application/vnd.google-apps.folder";

            // Build month candidates from the submission's closing month
            // so we only match Drive files from the SAME billing period.
            const parsedMonth = parseSnapshotMonth(sub.closingMonth); // "YYYY-MM" or "unknown"
            const MONTH_NAMES = ["january","february","march","april","may","june","july","august","september","october","november","december"];
            let driveYearStr = "";
            // Patterns that include the year — no cross-year or project-name false positives.
            const strictMonthCandidates: string[] = [];
            // Short Japanese patterns (e.g. "6月") — only accepted when the year also appears in the filename.
            const looseMonthCandidates: string[] = [];
            if (parsedMonth !== "unknown") {
              const [yearStr, monthStr] = parsedMonth.split("-");
              driveYearStr = yearStr;
              const monthNum   = parseInt(monthStr, 10);
              const mName      = MONTH_NAMES[monthNum - 1];  // "june"
              const mNameShort = mName.slice(0, 3);          // "jun"
              strictMonthCandidates.push(
                `${yearStr}-${monthStr}`,         // "2026-06"
                `${yearStr}/${monthStr}`,         // "2026/06"
                `${yearStr}${monthStr}`,          // "202606"
                `${mName}_${yearStr}`,            // "june_2026"
                `${mName} ${yearStr}`,            // "june 2026"
                `${yearStr}_${mName}`,            // "2026_june"
                `${yearStr} ${mName}`,            // "2026 june"
                `${mNameShort}_${yearStr}`,       // "jun_2026"
                `${mNameShort} ${yearStr}`,       // "jun 2026"
                `${yearStr}_${mNameShort}`,       // "2026_jun"
                `${yearStr} ${mNameShort}`,       // "2026 jun"
              );
              // Japanese month markers — require year present elsewhere in filename
              looseMonthCandidates.push(`${monthNum}月`, `${monthStr}月`); // "6月", "06月"
            }

            // Build name search from first 2 meaningful tokens of the resolved name
            const tokens = searchName.trim().split(/\s+/).filter(t => t.length > 2).slice(0, 2);
            if (!tokens.length) return null;
            // Drive API has no `in ancestors` — search by name across all accessible files
            // (service account only has access to the shared folder tree)
            const nameQ = tokens.map(t => `name contains '${t}'`).join(" and ");
            const q = `${nameQ} and mimeType != '${FOLDER_MIME}' and trashed=false`;

            console.log(`[Drive check] searching "${searchName}" month=${parsedMonth}${isEmail ? ` (from PDF, original="${sub.payerName}")` : ""} q="${q}"`);
            const res = await drive.files.list({
              q,
              fields: "files(id,name,mimeType,webViewLink)",
              supportsAllDrives: true,
              includeItemsFromAllDrives: true,
              pageSize: 20,
            });

            const found = (res.data.files ?? []).find(f => {
              if (!normName(f.name!).includes(payerNorm)) return false;
              // Only flag as duplicate if the file is from the SAME billing month+year.
              // Strict candidates include year+month combos (no cross-year false positives).
              // Loose Japanese patterns (e.g. "6月") are also accepted but only when the year
              // appears elsewhere in the filename (prevents matching June invoices from other years).
              if (parsedMonth !== "unknown") {
                const fnLower   = (f.name ?? "").toLowerCase();
                const strict    = strictMonthCandidates.some(c => fnLower.includes(c));
                const loose     = looseMonthCandidates.some(c => fnLower.includes(c)) && driveYearStr && fnLower.includes(driveYearStr);
                if (!strict && !loose) {
                  console.log(`[Drive check] Skipping "${f.name}" — month (${parsedMonth}) not confirmed in filename`);
                  return false;
                }
              }
              return true;
            });
            if (!found) {
              console.log(`[Drive check] No match for "${searchName}" month=${parsedMonth} (results=${res.data.files?.map(f => f.name).join(", ")})`);
              return null;
            }
            console.log(`[Drive check] Found: "${found.name}" for "${searchName}" (month=${parsedMonth}) — extracting amount for comparison`);

            let driveTotal: number | null = null;
            try {
              const dlRes = await drive.files.get(
                { fileId: found.id!, alt: "media", supportsAllDrives: true },
                { responseType: "arraybuffer" }
              );
              const driveExtracted = await extractFromPdf(new Uint8Array(dlRes.data as ArrayBuffer));
              driveTotal = driveExtracted.total ?? null;
              console.log(`[Drive check] Drive PDF amount: ${driveTotal}`);
            } catch (err) {
              console.warn(`[Drive check] Could not extract amount from Drive PDF "${found.name}":`, err);
            }

            return {
              fileId:      found.id!,
              filename:    found.name!,
              mimeType:    found.mimeType ?? "application/pdf",
              webViewLink: found.webViewLink ?? "",
              searchName,
              driveTotal,
            };
          } catch (err) {
            console.warn(`[Drive check] failed for "${sub.payerName}":`, err);
            return null;
          }
        })
      ),

      // Members list (used by AI + simple fallback)
      getMemberService().listMembers().catch((err) => {
        console.error("[validate] listMembers failed:", err);
        return [];
      }),
    ]);

    // ── Stage 4: contractor check — local first, live SharePoint fallback ───────
    // For email payers, use the PDF-extracted payee name for matching (email addresses
    // never match member display names). Fall back to the email if no payee name found.
    const effectiveNames = targets.map((sub, i) => {
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sub.payerName.trim());
      if (!isEmail) return sub.payerName;
      return baseResults[i]?.extractedFields?.memberName ?? sub.payerName;
    });

    // Pass 1: instant local match against synced members list
    const localMatches = targets.map((_, i) => matchMemberByName(effectiveNames[i], members));

    // Pass 2: for anyone not found locally, hit SharePoint live (only if Azure creds present)
    const hasAzureCreds = !!(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET);
    const spFallbacks = await Promise.all(
      targets.map((sub, i) => {
        if (localMatches[i] || !hasAzureCreds) return Promise.resolve(null);
        return checkMemberBySharePointContracts(effectiveNames[i]).catch((err) => {
          console.warn(`[SP fallback] failed for "${effectiveNames[i]}":`, err);
          return null;
        });
      })
    );

    // Auto-save newly discovered members to the local store so next validation is instant
    const memberSvc = getMemberService();
    await Promise.all(
      spFallbacks.map(async (sp, i) => {
        if (!sp?.matched) return;
        const name = effectiveNames[i];
        if (members.some(m => normName(m.displayName) === normName(name))) return;
        const now = new Date().toISOString();
        await memberSvc.saveMember({
          id:           generateId("mbr"),
          displayName:  name,
          email:        "",
          phone:        "",
          role:         "other",
          department:   "",
          employeeCode: "",
          joinDate:     now.slice(0, 10),
          status:       "active",
          avatarUrl:    "",
          notes:        `Auto-discovered via SharePoint validation (${sp.contractFileName ?? "contract"})`,
          createdAt:    now,
          updatedAt:    now,
        }).catch(err => console.warn(`[SP fallback] auto-save member failed for "${name}":`, err));
        console.log(`[SP fallback] Auto-saved new member "${name}" to local store`);
      })
    );

    // AI matching — only for submissions still unresolved after both passes
    const aiMatches = await Promise.all(
      targets.map((sub, i) => {
        if (localMatches[i] || spFallbacks[i]?.matched) return Promise.resolve(null);
        return matchSubmissionToMember(sub, members).catch((err) => {
          console.error(`[AI matching] failed for ${sub.id}:`, err);
          return null;
        });
      })
    );

    // ── Inject within-store duplicate issues ─────────────────────────────────────
    const enrichedBase = baseResults.map((r, i) => {
      const sub = targets[i];
      const payerNorm = sub.payerName.toLowerCase().replace(/\s+/g, "");
      const fromStore = allStoredForMonth.filter(
        (s) => s.payerName.toLowerCase().replace(/\s+/g, "") === payerNorm
      );
      const fromBatch = targets.filter(
        (t, j) => j !== i && t.payerName.toLowerCase().replace(/\s+/g, "") === payerNorm
      );
      // Also count from all known month submissions passed by the client (single-validate case)
      const fromContext = (allMonthSubmissions ?? []).filter(
        (s) => s.id !== sub.id && s.payerName.toLowerCase().replace(/\s+/g, "") === payerNorm
      );
      // Merge and deduplicate by row number
      const seenRows = new Set<number>();
      const existing = [...fromStore, ...fromBatch, ...fromContext].filter((s) => {
        if (seenRows.has(s.submissionRowNumber)) return false;
        seenRows.add(s.submissionRowNumber);
        return true;
      });
      if (existing.length === 0) return r;

      // Use claimed amount; fall back to extracted PDF total if the form field was empty
      const claimedRaw = parseFloat((sub.claimedAmountTaxIncluded ?? "").replace(/[^0-9.]/g, ""));
      const currentAmt = !isNaN(claimedRaw) ? claimedRaw : (r.extractedFields?.total ?? NaN);
      const existingAmts = existing
        .map((s) => parseFloat((s.claimedAmountTaxIncluded ?? "").replace(/[^0-9.]/g, "")))
        .filter((n) => !isNaN(n));
      const amountsDiffer = !isNaN(currentAmt) && existingAmts.some((ea) => Math.abs(currentAmt - ea) > ea * 0.1);

      const dupMsg = amountsDiffer
        ? `Duplicate: ${existing.length} other submission(s) for ${sub.payerName} this month — ⚠ amounts differ: previous ${existingAmts.join(" / ")} vs current ${currentAmt}`
        : `Duplicate: ${existing.length} other submission(s) for ${sub.payerName} this month`;

      return {
        ...r,
        issues: [...r.issues, dupMsg],
        statusCode: "REVIEW_REQUIRED" as const,
        riskLevel: (amountsDiffer ? "NEEDS_REVIEW" : r.riskLevel) as typeof r.riskLevel,
      };
    });

    // ── Merge all check results ───────────────────────────────────────────────────
    const results = await Promise.all(enrichedBase.map(async (r, i) => {
      const driveFile   = driveChecks[i];
      const localMember = localMatches[i];
      const spMatch     = spFallbacks[i];

      // ── Contractor result (computed first — shared by ALL return paths) ───────
      const matchedMemberName = localMember?.displayName ?? (spMatch?.matched ? targets[i].payerName : null);
      const matchedMemberRole = localMember?.role ?? "other";
      const matchSource       = localMember ? "local" : spMatch?.matched ? "sharepoint" : null;
      const info              = spMatch?.contractInfo;
      let contractorFields: Record<string, unknown> = {};
      if (matchSource) {
        const label = matchedMemberRole !== "other" ? `${matchedMemberName} (${matchedMemberRole})` : matchedMemberName;
        const parts: string[] = [`Accounting | Registered member: ${label}`];
        if (info?.contractedAmount) parts.push(`Contract: ${info.contractedAmount.toLocaleString()}`);
        if (info?.contractStart)    parts.push(`${info.contractStart}〜${info.contractEnd ?? ""}`);
        if (info?.scope)            parts.push(info.scope);
        contractorFields = {
          vendorMatched:          true,
          contractMatched:        !!info?.contractedAmount,
          riskLevel:              "OK",
          reviewerRecommendation: parts.join(" | "),
        };
      }

      // Drive check: payerName was an email with no PDF name fallback
      const driveAny = driveFile as Record<string, unknown> | null;
      if (driveAny?.cannotVerify) {
        return {
          ...r,
          ...contractorFields,
          ...(validatedBy ? { validatedBy } : {}),
          statusCode: "REVIEW_REQUIRED" as const,
          riskLevel:  matchSource ? "OK" as const : "NEEDS_REVIEW" as const,
          issues:     [...r.issues, `Drive check skipped: ${driveAny.reason as string}`],
        };
      }

      // Drive check: file found — compare amounts against the submitted invoice
      if (driveFile) {
        const df         = driveFile as typeof driveFile & { searchName?: string; driveTotal?: number | null };
        const usedName   = df.searchName ?? targets[i].payerName;
        const driveTotal = df.driveTotal ?? null;
        const submittedTotal = baseResults[i]?.extractedFields?.total ?? null;
        const TOLERANCE  = 1;

        const canCompare    = submittedTotal !== null && driveTotal !== null;
        const amountsDiffer = canCompare && Math.abs(submittedTotal - driveTotal) > TOLERANCE;

        if (amountsDiffer) {
          const issueMsg = [
            `Drive file found: ${driveFile.filename}`,
            `Name: "${usedName}" ✓ found in Drive`,
            `Amount differs — Drive: ${driveTotal}, this submission: ${submittedTotal} — may be a different invoice`,
          ].join("\n");
          return {
            ...r,
            ...contractorFields,
            ...(validatedBy ? { validatedBy } : {}),
            statusCode: "REVIEW_REQUIRED" as const,
            issues:     [...r.issues, issueMsg],
          };
        }

        const issueMsg = [
          `Already filed in Drive: ${driveFile.filename}`,
          `Name: "${usedName}" ✓ found in Drive`,
          canCompare ? `Amount: ${driveTotal} matches ✓` : "",
        ].filter(Boolean).join("\n");
        return {
          ...r,
          ...contractorFields,
          ...(validatedBy ? { validatedBy } : {}),
          statusCode:        "ALREADY_PROCESSED" as const,
          duplicateDetected: true,
          issues:            [...r.issues, issueMsg],
        };
      }

      if (matchSource) {
        console.log(`[validate] Contractor match (${matchSource}) for "${targets[i].payerName}": "${matchedMemberName}"`);
        const pdfAmountMismatch = r.issues.some(iss => iss.startsWith("AMOUNT_MISMATCH"));
        return {
          ...r,
          ...contractorFields,
          ...(validatedBy ? { validatedBy } : {}),
          riskLevel: pdfAmountMismatch ? ("NEEDS_REVIEW" as const) : ("OK" as const),
          reviewerRecommendation: pdfAmountMismatch
            ? `${contractorFields.reviewerRecommendation} | ⚠ Claimed amount does not match invoice PDF`
            : contractorFields.reviewerRecommendation as string,
        };
      }

      // enrichWithRisk fallback (uses local member store for risk scoring)
      const simple = await enrichWithRisk(r, targets[i], memberSvc).catch(() => r);

      if (simple.vendorMatched && simple.contractMatched) {
        return { ...simple, ...(validatedBy ? { validatedBy } : {}) };
      }

      // Last resort: AI matching
      const ai = aiMatches[i];
      if (ai && ai.vendorId !== null) {
        return {
          ...simple,
          ...(validatedBy ? { validatedBy } : {}),
          vendorMatched:   true,
          contractMatched: ai.contractId !== null,
          contractId:      ai.contractId ?? r.contractId,
          riskLevel:       "OK" as const,
          reviewerRecommendation: ai.reviewerRecommendation,
        };
      }

      return { ...simple, ...(validatedBy ? { validatedBy } : {}) };
    }));

    // Persist validation results
    await Promise.all(results.map((r) => storageSvc.saveValidationResult(r)));

    // Build per-submission logs
    const logs: ProcessingLog[] = results.map((r) => ({
      id: generateId(),
      runId,
      submissionId: r.submissionId,
      step: "VALIDATION_COMPLETE" as const,
      result: r.statusCode === "READY"
        ? "OK"
        : r.statusCode === "REVIEW_REQUIRED"
        ? "WARNING"
        : "ERROR",
      message: r.issues.length > 0 ? r.issues.join(", ") : r.statusCode,
      timestamp: new Date().toISOString(),
    }));
    await Promise.all(logs.map((l) => storageSvc.appendLog(l)));

    // Count outcomes
    const ready         = results.filter((r) => r.statusCode === "READY").length;
    const reviewRequired = results.filter((r) => r.statusCode === "REVIEW_REQUIRED").length;
    const errors        = results.filter((r) =>
      !["READY", "REVIEW_REQUIRED", "ALREADY_PROCESSED", "DUPLICATE_FILE", "SAVED"].includes(r.statusCode)
    ).length;

    // Update run to COMPLETE
    const completedRun: ProcessingRun = {
      ...run,
      completedAt: new Date().toISOString(),
      ready,
      reviewRequired,
      errors,
      status: "COMPLETE",
    };
    await storageSvc.saveRun(completedRun);

    return NextResponse.json({ count: results.length, results });
  } catch (err) {
    console.error("[POST /api/invoices/validate]", err);
    // Mark run as FAILED
    await storageSvc.saveRun({ ...run, completedAt: new Date().toISOString(), status: "FAILED" });
    return NextResponse.json(
      { error: "Validation failed", detail: String(err) },
      { status: 500 }
    );
  }
}
