# SDC Invoice Tool — User Guide

> ⚠️ **Important:** This tool verifies and files invoices only. It does **not** execute payments.

---

## What Is This Tool?

The SDC Invoice Tool is the monthly workflow for verifying contractor invoices and filing them to Google Drive. It replaces manual checking by automatically validating PDF attachments, amounts, dates, and tax fields — then filing the approved files in the right folder.

---

## Who Uses It?

| Role | What they do |
|---|---|
| **Admin / SDC Staff** | Upload CSV, run validation, approve invoices, file to Drive |
| **Team Members** | Receive Teams reminders if their invoice is missing or overdue |

---

## Monthly Workflow (Step by Step)

### Step 1 — Sign In

Go to the app URL and sign in with your SDC account email and password.

---

### Step 2 — Upload the Invoice CSV

1. Click **Invoices** in the left sidebar
2. Click **Upload Excel** (top right)
3. Select the CSV/Excel file exported from the submission system
4. The app reads the file and maps the columns automatically

> If columns are not mapped correctly, use the **Column Mapping** panel to fix them manually.

---

### Step 3 — Load & Validate on the Dashboard

1. Click **Dashboard** in the sidebar
2. Select the **month** you are processing (top right of the header)
3. Click **Load Invoices** — the stats cards will update
4. Click **Run Validation** — the app checks every invoice automatically

**What validation checks:**

| Check | What it means |
|---|---|
| PDF Accessible | The attachment link opens correctly |
| Invoice Date Found | A date was extracted from the PDF |
| Tax Included | Consumption tax (10%) is present |
| Subtotal / Total Found | Amounts were read from the PDF |
| Amount Matches Sheet | PDF total matches the submitted amount |
| No Duplicate | This file hasn't been filed before |

---

### Step 4 — Review the Stats Cards

After validation the dashboard shows 7 counters. Click any card to filter the invoice list below.

| Card | Meaning | Action needed |
|---|---|---|
| **Total** | All invoices for the month | — |
| **Ready** | Passed all checks | Can be filed immediately |
| **Review Required** | Failed one or more checks | Manual review needed |
| **Missing Attachment** | No PDF attached | Contact the contractor |
| **Already Processed** | Filed in a previous run | No action needed |
| **Errors** | System error during validation | Check Logs page |
| **Saved** | Successfully filed to Drive | Done |

---

### Step 5 — Handle "Review Required" Invoices

1. Click the **Review Required** card to filter the list
2. Click **View** on any row to open the detail panel (right side)
3. The panel shows exactly which check failed and why
4. If the invoice is acceptable despite the issue, click **Approve**
   - Approved invoices are treated as Ready and will be filed in the next step

---

### Step 6 — Save Ready Files to Google Drive

1. Back on the Dashboard, click **Save Ready Files**
2. The app files all **Ready** and **Approved** invoices into the correct monthly folder on Google Drive
3. A green banner confirms how many files were saved

> The folder name and filename format are set in **Settings** and follow the configured naming rule (e.g. `田中 太郎_invoice_march.pdf`).

---

### Step 7 — Verify in the Logs

1. Click **Logs** in the sidebar
2. Select the latest run from the left panel
3. Check that all rows show **OK** — any **ERROR** or **WARNING** rows need attention

---

## Automatic Reminders (Teams)

Every morning at **09:00 JST** the tool automatically sends reminder cards to Microsoft Teams for:

| Reminder type | When it triggers |
|---|---|
| **Missing Invoice** | A contractor hasn't submitted for the current month |
| **Stale Review** | An invoice has been in "Review Required" for too many days |
| **Due Date Approaching** | Payment due date is within the threshold (default: 5 days) |
| **Overdue** | Payment due date has already passed |

You can also trigger reminders manually from the Dashboard → **Send Reminders** button.

---

## Vendor & Contract Management

### Vendors (Sidebar → Vendors)

Register each contractor here. The app uses this list to match invoice payer names.

| Field | Notes |
|---|---|
| Name | Official name as it appears on invoices |
| Aliases | Alternative spellings (one per line) |
| Tax Registration No. | T + 13 digits |
| Default Reviewer | Person responsible for approving this vendor's invoices |

### Contracts (Sidebar → Contracts)

Register the expected monthly amount and period for each contractor. The validation step uses this to flag amount mismatches.

| Field | Notes |
|---|---|
| Vendor | Select from registered vendors |
| Project Name | Engagement or project label |
| Period | Start date → End date |
| Monthly Amount | Expected invoice amount in JPY |
| Status | Active / Expired / Cancelled |

---

## Settings (Sidebar → Settings)

Administrators can configure:

- **Completed Status Values** — which payment status values count as "done"
- **Skip Status Values** — rows with these values are ignored during processing
- **Month Folder Naming** — how Google Drive monthly folders are named (`2024-03` or `2024年03月`)
- **Filename Template** — how filed PDFs are named
- **Duplicate Detection** — none / by filename / by hash
- **Amount Tolerance** — acceptable difference between PDF total and sheet amount (in yen)
- **Teams Webhook URL** — where reminder cards are sent
- **Reminder thresholds** — how many days before triggering stale / due date alerts

---

## Quick Reference — Status Codes

| Status | Colour | Meaning |
|---|---|---|
| Ready | Green | All checks passed — safe to file |
| Review Required | Amber | One or more checks failed — needs a human look |
| Missing Attachment | Red | No PDF link found |
| Amount Mismatch | Red | PDF total ≠ sheet amount |
| Already Processed | Grey | Filed in a previous run |
| Saved | Blue | Successfully filed to Google Drive |
| Save Error | Red | Filing failed — check Logs |

---

## Tips

- **Always select the correct month** before loading — the app defaults to the current month.
- **Approve sparingly** — use Approve only when you've manually confirmed the invoice is correct despite a failed check.
- **Check Logs after every run** — they show exactly what happened to each invoice row.
- **The tool does not pay anyone** — filing to Drive is the final step; payment is handled separately.

---

*SDC Invoice Tool — Internal documentation. Last updated: June 2026.*
