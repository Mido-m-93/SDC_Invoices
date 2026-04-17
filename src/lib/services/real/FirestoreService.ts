// ─────────────────────────────────────────────────────────────────────────────
// lib/services/real/FirestoreService.ts — Real Firestore integration stub
//
// HOW TO ACTIVATE:
// 1. Set NEXT_PUBLIC_USE_MOCK=false
// 2. Set GOOGLE_PROJECT_ID
// 3. Uncomment and import in lib/services/index.ts
// 4. npm install @google-cloud/firestore
//
// Firestore collections:
//   invoice_results/{submissionId}     → InvoiceValidationResult
//   invoice_filed/{submissionId}       → FiledDocument
//   invoice_runs/{runId}               → ProcessingRun
//   invoice_logs/{logId}               → ProcessingLog
//   app_config/main                    → AppConfig
// ─────────────────────────────────────────────────────────────────────────────

/*
import { Firestore } from "@google-cloud/firestore";
import type { IStorageService } from "../types";
import type {
  InvoiceValidationResult,
  FiledDocument,
  ProcessingRun,
  ProcessingLog,
  AppConfig,
} from "@/types";
import { DEFAULT_CONFIG } from "@/config/defaults";

const db = new Firestore({ projectId: process.env.GOOGLE_PROJECT_ID });

export class FirestoreStorageService implements IStorageService {
  async saveValidationResult(result: InvoiceValidationResult) {
    await db.collection("invoice_results").doc(result.submissionId).set(result);
  }

  async saveFiledDocument(doc: FiledDocument) {
    await db.collection("invoice_filed").doc(doc.submissionId).set(doc);
  }

  async loadValidationResults(submissionIds: string[]) {
    const results: InvoiceValidationResult[] = [];
    for (const id of submissionIds) {
      const snap = await db.collection("invoice_results").doc(id).get();
      if (snap.exists) results.push(snap.data() as InvoiceValidationResult);
    }
    return results;
  }

  async loadFiledDocuments(submissionIds: string[]) {
    const docs: FiledDocument[] = [];
    for (const id of submissionIds) {
      const snap = await db.collection("invoice_filed").doc(id).get();
      if (snap.exists) docs.push(snap.data() as FiledDocument);
    }
    return docs;
  }

  async loadRuns() {
    const snap = await db.collection("invoice_runs").orderBy("startedAt", "desc").limit(50).get();
    return snap.docs.map((d) => d.data() as ProcessingRun);
  }

  async saveRun(run: ProcessingRun) {
    await db.collection("invoice_runs").doc(run.id).set(run);
  }

  async appendLog(log: ProcessingLog) {
    await db.collection("invoice_logs").doc(log.id).set(log);
  }

  async loadLogs(runId: string) {
    const snap = await db.collection("invoice_logs").where("runId", "==", runId).orderBy("timestamp").get();
    return snap.docs.map((d) => d.data() as ProcessingLog);
  }

  async loadConfig(): Promise<AppConfig> {
    const snap = await db.collection("app_config").doc("main").get();
    return snap.exists ? (snap.data() as AppConfig) : DEFAULT_CONFIG;
  }

  async saveConfig(config: AppConfig) {
    await db.collection("app_config").doc("main").set(config);
  }
}
*/

export {};
