// src/lib/navTabs.ts
// Shared list of sidebar tabs that can be individually granted/restricted per
// Member via the Users page. Keys match each tab's href, which is also used
// as the storage key in app_metadata.allowedTabs. Dashboard and Users are
// deliberately excluded — Dashboard is always the landing page for everyone,
// and Users is already admin-only regardless of this list.
import type { TranslationKey } from "@/translations";

export interface ManageableTab {
  href: string;
  labelKey: TranslationKey;
  /**
   * Hidden from everyone but admins until an admin explicitly lists it in a
   * Member's allowedTabs. Unlike normal tabs, a `null` (unrestricted) Member
   * does NOT get it — it needs a deliberate grant.
   */
  grantOnly?: boolean;
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
  { href: "/reports",         labelKey: "nav_reports" },
  { href: "/config",          labelKey: "nav_config" },
  { href: "/feedback",        labelKey: "nav_feedback" },
  { href: "/sheet-data",      labelKey: "nav_sheet_data", grantOnly: true },
];

const GRANT_ONLY_HREFS = new Set(MANAGEABLE_TABS.filter((t) => t.grantOnly).map((t) => t.href));

/** Tabs a Member sees by default when unrestricted (everything except grant-only tabs). */
export const REGULAR_TABS: ManageableTab[] = MANAGEABLE_TABS.filter((t) => !t.grantOnly);

/**
 * `null` allowedTabs means unrestricted — every regular tab is visible.
 * Grant-only tabs are visible to admins, or to Members who list them explicitly.
 */
export function canSeeTab(href: string, allowedTabs: string[] | null, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (GRANT_ONLY_HREFS.has(href)) return allowedTabs?.includes(href) ?? false;
  if (allowedTabs === null) return true;
  return allowedTabs.includes(href);
}

/**
 * Turn the Users-page tick boxes into the value stored in allowedTabs: null
 * (unrestricted) only when every regular tab is ticked and no grant-only tab is,
 * otherwise the explicit list (so a grant-only tab is never granted implicitly).
 */
export function tabsToStore(selected: ReadonlySet<string>): string[] | null {
  const allRegular = REGULAR_TABS.every((t) => selected.has(t.href));
  const anyGrantOnly = Array.from(GRANT_ONLY_HREFS).some((h) => selected.has(h));
  return allRegular && !anyGrantOnly ? null : Array.from(selected);
}

const MANAGEABLE_HREFS = new Set(MANAGEABLE_TABS.map((t) => t.href));

/** Valid `allowedTabs` request value: null (unrestricted) or an array of known tab hrefs. */
export function isValidTabSelection(tabs: unknown): tabs is string[] | null {
  if (tabs === null) return true;
  return Array.isArray(tabs) && tabs.every((h) => typeof h === "string" && MANAGEABLE_HREFS.has(h));
}
