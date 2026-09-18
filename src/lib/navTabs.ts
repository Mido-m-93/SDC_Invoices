// src/lib/navTabs.ts
// Shared list of sidebar tabs that can be individually granted/restricted per
// Member via the Users page. Keys match each tab's href, which is also used
// as the storage key in user_metadata.allowedTabs. Dashboard and Users are
// deliberately excluded — Dashboard is always the landing page for everyone,
// and Users is already admin-only regardless of this list.
import type { TranslationKey } from "@/translations";

export interface ManageableTab {
  href: string;
  labelKey: TranslationKey;
}

export const MANAGEABLE_TABS: ManageableTab[] = [
  { href: "/proposals",       labelKey: "nav_proposals" },
  { href: "/budget",          labelKey: "nav_budget" },
  { href: "/contracts",       labelKey: "nav_contracts" },
  { href: "/invoices",        labelKey: "nav_invoices" },
  { href: "/expenses",        labelKey: "nav_expenses" },
  { href: "/cash-collection", labelKey: "nav_cash_collection" },
  { href: "/cash-payment",    labelKey: "nav_cash_payment" },
  { href: "/logs",            labelKey: "nav_logs" },
  { href: "/archives",        labelKey: "nav_archives" },
  { href: "/config",          labelKey: "nav_config" },
];

/** `null` allowedTabs means unrestricted — every tab is visible. */
export function canSeeTab(href: string, allowedTabs: string[] | null, isAdmin: boolean): boolean {
  if (isAdmin || allowedTabs === null) return true;
  return allowedTabs.includes(href);
}
