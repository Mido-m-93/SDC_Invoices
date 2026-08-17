# Pipeline Architecture — Target Design

## Flow

```
New Opportunity
        │
        ▼
Pipeline (Lead)
        │
        ▼
Proposal
        │
        ▼
AI verifies Proposal ↔ Pipeline
        │
        ▼
Contract
        │
        ▼
AI verifies Contract ↔ Proposal
        │
        ▼
Invoice
        │
        ▼
AI verifies Invoice ↔ Contract
        │
        ▼
Collection / Payment
```

Every new client engagement begins as a **new opportunity**, which is recorded in the **Pipeline (Lead)**. Once the opportunity is qualified, a **Proposal** is created, and the AI verifies that the proposal matches the information stored in the pipeline. After the proposal is approved, a **Contract** is generated, and the AI validates that its contents are consistent with the approved proposal. Based on the finalized contract, an **Invoice** is issued, and the AI verifies that the invoice accurately reflects the contract details. Once all validations are successfully completed, the process proceeds to **Collection/Payment**, ensuring complete consistency and traceability across every stage of the business workflow.

## Status

| Stage | Status |
|---|---|
| Lead exists with a stage field | ✅ Done |
| Lead ↔ Proposal link enforced | ✅ Done (`Proposal.leadId`, required on create) |
| AI verifies Proposal ↔ Lead | ✅ Done (`/api/proposals/[id]/verify`, auto-run on accept) |
| Proposal → Contract link enforced | ✅ Done (required for client contracts; vendor-only contracts unaffected) |
| AI verifies Contract ↔ Proposal | ✅ Done (`/api/contracts/[id]/verify`, auto-run on accept) |
| Contract → Invoice link enforced | ✅ Done — via `OutboundInvoice.contractId` (client invoices), required on create, derived server-side from the Contract |
| AI verifies Invoice ↔ Contract | ✅ Done, two places: client invoices via `/api/outbound-invoices/[id]/verify`; contractor expense claims (separate system, see below) via `/api/invoices/validate` |
| Collection/Payment | ✅ Done (`PaymentRecord`) |
| Contract sync from SharePoint | ✅ Done (`/api/contracts/sync`, Client/Vendor/Partner folders — confirm real folder names via `GET /api/debug/sharepoint-folder?which=contracts` before relying on it) |
| Pipeline sync from SharePoint (Leads page) | ✅ Done — live SharePoint source, human approval still required before any Client/Lead is created (confirm folder scope via `GET /api/debug/sharepoint-folder?which=pipeline`) |

## Two separate "Invoice" systems — don't confuse them

- **`OutboundInvoice`** (`/outbound-invoices`) — the client-facing invoice for this pipeline: issued FROM a Contract, TO a client. `contractId` is required and enforced server-side; client/project/currency are derived from the linked Contract, not free-typed. This is the Contract→Invoice→Collection/Payment stage in the diagram above. Create one directly from an active contract via the "Create Invoice" link on the Contracts page.
- **`InvoiceSubmission`** (`/invoices`) — an unrelated contractor **expense-claim** system (paying members/contractors), matched against a member's cached SharePoint contract. Not part of the sales pipeline; left as-is.

## Verification before relying on this in production

- Confirm SharePoint folder names: `GET /api/debug/sharepoint-folder?which=contracts` and `?which=pipeline`.
- Override folder paths via env if they don't match the defaults: `MICROSOFT_BUSINESS_CONTRACTS_FOLDERS`, `MICROSOFT_PIPELINE_FOLDER_PATH`.
- Test both sync buttons against a throwaway/test folder before pointing at the live folders.

Update this table as each row ships.
