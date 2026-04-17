# 業務委託請求書確認・保管ツール
## Contractor Invoice Verification & Filing Tool

**SDC Internal Tool — Phase 1**

> ⚠️ このツールは支払いを実行しません。読み取り・検証・保管のみを行います。  
> ⚠️ This tool does NOT execute payments. It only reads, validates, and stores.

---

## Quick Start (Mock Mode)

```bash
# 1. Install dependencies
npm install

# 2. Start development server (uses mock data, no real credentials needed)
npm run dev

# 3. Open http://localhost:3000
```

The app runs entirely on mock data by default (`NEXT_PUBLIC_USE_MOCK=true`).  
All screens are functional and interactive immediately.

---

## Project Structure

```
src/
├── app/                        # Next.js App Router pages + API routes
│   ├── dashboard/page.tsx      # Dashboard with stats
│   ├── invoices/page.tsx       # Invoice list with filter + actions
│   ├── logs/page.tsx           # Processing run logs
│   ├── config/page.tsx         # App settings UI
│   └── api/
│       ├── invoices/route.ts           # GET /api/invoices?month=YYYY-MM
│       ├── invoices/validate/route.ts  # POST /api/invoices/validate
│       ├── invoices/file/route.ts      # POST /api/invoices/file
│       └── logs/route.ts              # GET /api/logs?runId=...
│
├── components/
│   ├── layout/AppShell.tsx     # Sidebar navigation + language toggle
│   └── invoice/
│       └── InvoiceDetailPanel.tsx  # Slide-out detail panel
│   └── ui/
│       ├── Button.tsx
│       ├── StatusBadge.tsx
│       ├── StatCard.tsx
│       ├── PageHeader.tsx
│       ├── ValidationCheck.tsx
│       └── MonthSelector.tsx
│
├── lib/
│   ├── services/
│   │   ├── types.ts            # Service interfaces (ISheetsService, etc.)
│   │   ├── index.ts            # Factory (mock vs real switch)
│   │   ├── mock/               # Mock implementations (dev mode)
│   │   └── real/               # Real implementations (production stubs)
│   │       ├── SheetsService.ts
│   │       ├── DriveService.ts
│   │       └── FirestoreService.ts
│   ├── validation/
│   │   └── invoiceValidator.ts # Core validation logic
│   └── utils/index.ts          # Shared utilities
│
├── config/
│   └── defaults.ts             # AppConfig defaults + filename/folder builders
│
├── translations/
│   ├── ja.ts                   # Japanese strings (default)
│   ├── en.ts                   # English strings
│   └── index.ts                # LanguageProvider + useLanguage hook
│
└── types/index.ts              # All TypeScript interfaces
```

---

## Data Flow

```
Google Sheets (rows)
        ↓
SheetsService.loadSubmissions()
        ↓
InvoiceSubmission[] (normalized)
        ↓
ValidationService.validate()
        ↓  ← fetches PDF via DriveService
InvoiceValidationResult (statusCode, issues[])
        ↓
Human Review (UI)
        ↓ [human clicks Save]
DriveService.uploadPdf() → Google Drive
        ↓
FiledDocument (stored in Firestore)
        ↓
ProcessingLog (audit trail)
```

---

## Status Codes

| Code | Meaning |
|------|---------|
| `READY` | All checks passed, safe to file |
| `REVIEW_REQUIRED` | One or more soft warnings, human must check |
| `MISSING_ATTACHMENT` | No attachment URL in sheet row |
| `PDF_LINK_ERROR` | Attachment URL could not be fetched |
| `DATE_MISSING` | Invoice date not found in document |
| `TAX_MISSING` | Tax amount not found in document |
| `AMOUNT_MISMATCH` | Invoice total ≠ sheet claimed amount |
| `PROJECT_INFO_MISSING` | No department / project name found |
| `ALREADY_PROCESSED` | paymentProcessingStatus is in completedStatuses |
| `DUPLICATE_FILE` | File with same name already in Drive folder |
| `SAVED` | Successfully filed to Drive |
| `SAVE_ERROR` | Drive upload failed |

---

## Connecting Real APIs

### Step 1: Google Cloud Setup

1. Create a GCP project
2. Enable: Google Sheets API, Google Drive API, Firestore
3. Create a Service Account with roles:
   - `roles/spreadsheets.viewer` (Sheets)
   - `roles/drive.file` (Drive — scoped to your folders)
   - `roles/datastore.user` (Firestore)
4. Download the JSON key
5. Share your spreadsheet and Drive folder with the service account email

### Step 2: Environment Variables

```bash
cp .env.local.example .env.local
# Fill in:
NEXT_PUBLIC_USE_MOCK=false
GOOGLE_CLIENT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SPREADSHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
GOOGLE_SHEET_NAME=シート1
GOOGLE_DRIVE_ROOT_FOLDER_ID=1abc_your_folder_id
GOOGLE_PROJECT_ID=your-gcp-project-id
```

### Step 3: Uncomment Real Services

In each real service file (`src/lib/services/real/`), uncomment the implementation.

Then in `src/lib/services/index.ts`, replace mock instantiation:

```typescript
// Before:
_sheets = new MockSheetsService();

// After:
import { RealSheetsService } from "./real/SheetsService";
_sheets = new RealSheetsService();
```

### Step 4: Install googleapis

```bash
npm install googleapis @google-cloud/firestore
```

---

## Configuration (Settings Page)

The `/config` page lets you set:

| Setting | Purpose |
|---------|---------|
| `completedStatuses` | 支払処理 values that mean "already done" |
| `skipStatuses` | Rows to skip entirely |
| `monthFolderNamingMode` | How to name Drive month folders |
| `filenameRule` | Template for renamed PDF files |
| `duplicateDetectionMode` | none / filename / hash |
| `amountToleranceAbsolute` | How much ¥ difference is acceptable |

In production these are stored in Firestore `app_config/main`.

---

## Known Unknowns (To Confirm)

These are deliberately left configurable pending confirmation:

1. **Exact values in 支払処理 column** → set in Config page `completedStatuses`
2. **Attachment link format** → Google Drive link parser supports multiple formats; adjust `DriveService.fetchAttachment()` if needed
3. **Month folder naming convention** → set in Config page `monthFolderNamingMode`
4. **Exact closingMonth date format** → `tryParseToYYYYMM()` in `config/defaults.ts` handles common formats; extend if needed

---

## Deployment (Google Cloud Run)

```bash
# Build Docker image
docker build -t sdc-invoice-tool .

# Push to Artifact Registry
docker tag sdc-invoice-tool gcr.io/YOUR_PROJECT/sdc-invoice-tool
docker push gcr.io/YOUR_PROJECT/sdc-invoice-tool

# Deploy to Cloud Run
gcloud run deploy sdc-invoice-tool \
  --image gcr.io/YOUR_PROJECT/sdc-invoice-tool \
  --region asia-northeast1 \
  --set-secrets GOOGLE_PRIVATE_KEY=google-private-key:latest \
  --set-env-vars GOOGLE_CLIENT_EMAIL=sa@project.iam.gserviceaccount.com \
  --no-allow-unauthenticated
```

Use Google Secret Manager for all credentials. Never commit `.env.local` to git.

---

## Implementation Phases

| Phase | Status | Scope |
|-------|--------|-------|
| 1 | ✅ Done | Scaffold, types, mock UI, translations, dashboard, invoice list |
| 2 | 🔲 Next | Real PDF extraction (pdf-parse or Document AI), amount comparison |
| 3 | 🔲 | Real Drive upload, duplicate hash check, Firestore logs |
| 4 | 🔲 | Config page real persistence, spreadsheet write-back |
| 5 | 🔲 | Enhanced review workflow, audit exports |

---

## Safety Principles

- **No payment actions** — no bank API, no automatic approval, no write-back to payment columns
- **Review-first** — all ambiguous cases are flagged `REVIEW_REQUIRED` rather than failing or auto-passing
- **Audit trail** — every processing step is logged with timestamp and result
- **Config-driven** — all business values (statuses, folder names, filenames) are configurable, not hardcoded
