// Builds the bank-transfer summary and CSV from approved, unpaid expense claims.
// Pure functions (no I/O) so the Expenses page and the tests share one code path.

import type { ExpenseClaim } from "@/types";

export interface BankTransferRow {
  recipient: string;
  email: string;
  bankAccount: string;
  currency: string;
  /** Total in the currency's major unit (JPY: whole yen, others: 2 decimals). */
  amount: number;
  claimCount: number;
  /** Claim details, one value per claim (newest first) joined with " | ". */
  feeReason: string;
  expenseReason: string;
  submitted: string;
  expenseDate: string;
  attachment: string;
  /** One value when every claim has the same status, otherwise per claim joined with " | ". */
  status: string;
  memo: string;
  /** Empty when the row is ready to pay; otherwise what to check first. */
  note: string;
}

export interface BankTransferResult {
  rows: BankTransferRow[];
  /** Grand total per currency; currencies are never added together. */
  totalsByCurrency: Record<string, number>;
  csv: string;
}

const CSV_HEADER = [
  "Recipient", "Email", "Bank Account", "Currency", "Amount", "Claims",
  "Transportation Fee Reason", "Expense Reason", "Submitted", "Expense Date", "Attachment", "Status",
  "Memo", "Note",
];
const JOIN = " | ";
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND"]);

export interface BankTransferOptions {
  /** Also include claims already marked paid (e.g. to re-create a record of a transfer). */
  includePaid?: boolean;
}

function isPaid(c: ExpenseClaim): boolean {
  return c.status === "paid" || !!c.paidAt;
}

/** Approved and not yet paid (or, with includePaid, paid too), and not soft-deleted. */
function isPayable(c: ExpenseClaim, includePaid: boolean): boolean {
  if (c.deletedAt) return false;
  if (c.status === "approved") return includePaid || !isPaid(c);
  return includePaid && c.status === "paid";
}

function toMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? Math.round(amount) : Math.round(amount * 100);
}

function fromMinorUnits(minor: number, currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? minor : minor / 100;
}

function formatAmount(amount: number, currency: string): string {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? String(amount) : amount.toFixed(2);
}

// Cells that start with these characters are executed as formulas by Excel /
// Sheets. Claim text comes from a public form, so neutralise them.
function escapeCell(value: string, isText = true): string {
  let v = value;
  if (isText && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Per-claim values joined in claim order so columns line up; blank if every value is empty. */
function joinPerClaim(values: string[]): string {
  const cleaned = values.map((v) => (v ?? "").trim());
  return cleaned.every((v) => v === "") ? "" : cleaned.join(JOIN);
}

export function buildBankTransfer(
  claims: ExpenseClaim[],
  memo: string,
  options: BankTransferOptions = {}
): BankTransferResult {
  type Group = { claims: ExpenseClaim[]; currency: string };
  const groups = new Map<string, Group>();

  for (const c of claims.filter((x) => isPayable(x, options.includePaid ?? false))) {
    const currency = (c.currency || "JPY").toUpperCase();
    const member = (c.submittedByEmail || c.submittedBy).trim().toLowerCase();
    const key = `${member}|${currency}`;
    const g = groups.get(key);
    if (g) g.claims.push(c);
    else groups.set(key, { claims: [c], currency });
  }

  const rows: BankTransferRow[] = [...groups.values()].map(({ claims: cs, currency }) => {
    // Newest claim first, so the most recent name / bank account wins.
    const sorted = [...cs].sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
    const accounts = [...new Set(sorted.map((c) => (c.bankAccount ?? "").trim()).filter(Boolean))];
    const minor = cs.reduce((sum, c) => sum + toMinorUnits(c.amount, currency), 0);
    const notes: string[] = [];
    if (accounts.length === 0) notes.push("No bank account on the claims");
    if (accounts.length > 1) notes.push(`${accounts.length} different bank accounts on the claims: confirm which to use`);
    if (minor <= 0) notes.push("Total is zero or negative");
    const paidCount = cs.filter(isPaid).length;
    if (paidCount === cs.length) notes.push("Already marked paid: do not pay again");
    else if (paidCount > 0) notes.push(`${paidCount} of ${cs.length} claims already marked paid: total includes them`);
    return {
      recipient: sorted[0].submittedBy.trim(),
      email: sorted[0].submittedByEmail.trim(),
      bankAccount: accounts[0] ?? "",
      currency,
      amount: fromMinorUnits(minor, currency),
      claimCount: cs.length,
      feeReason: joinPerClaim(sorted.map((c) => c.description)),
      expenseReason: joinPerClaim(sorted.map((c) => c.expenseReason)),
      submitted: joinPerClaim(sorted.map((c) => (c.submittedAt || "").slice(0, 10))),
      expenseDate: joinPerClaim(sorted.map((c) => (c.expenseDate || "").slice(0, 10))),
      attachment: joinPerClaim(sorted.map((c) => c.receiptUrl)),
      status: new Set(sorted.map((c) => c.status)).size === 1 ? sorted[0].status : sorted.map((c) => c.status).join(JOIN),
      memo,
      note: notes.join("; "),
    };
  });

  rows.sort((a, b) => a.recipient.localeCompare(b.recipient) || a.currency.localeCompare(b.currency));

  const totalsMinor: Record<string, number> = {};
  for (const r of rows) totalsMinor[r.currency] = (totalsMinor[r.currency] ?? 0) + toMinorUnits(r.amount, r.currency);
  const totalsByCurrency = Object.fromEntries(
    Object.entries(totalsMinor).map(([cur, minor]) => [cur, fromMinorUnits(minor, cur)])
  );

  const lines = [
    CSV_HEADER.join(","),
    ...rows.map((r) =>
      [
        escapeCell(r.recipient), escapeCell(r.email), escapeCell(r.bankAccount), escapeCell(r.currency),
        escapeCell(formatAmount(r.amount, r.currency), false), String(r.claimCount),
        escapeCell(r.feeReason), escapeCell(r.expenseReason), escapeCell(r.submitted), escapeCell(r.expenseDate),
        escapeCell(r.attachment), escapeCell(r.status), escapeCell(r.memo), escapeCell(r.note),
      ].join(",")
    ),
  ];
  // UTF-8 BOM so Excel opens Japanese names correctly; CRLF per RFC 4180.
  const csv = "﻿" + lines.join("\r\n") + "\r\n";

  return { rows, totalsByCurrency, csv };
}
