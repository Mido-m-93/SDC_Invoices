"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/translations";
import clsx from "clsx";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { key: "nav_dashboard" as const, href: "/dashboard", icon: GridIcon },
  { key: "nav_invoices" as const, href: "/invoices", icon: FileIcon },
  { key: "nav_logs" as const, href: "/logs", icon: LogIcon },
  { key: "nav_config" as const, href: "/config", icon: CogIcon },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const { t, language, setLanguage } = useLanguage();
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <aside className="fixed inset-y-0 left-0 z-40 w-[220px] bg-[#1a3d2b] text-white">
        <div className="border-b border-white/10 px-5 py-6">
          <p className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-white/40">
            SDC
          </p>
          <p className="text-sm font-semibold leading-snug text-white">
            {t("app_name_short")}
          </p>
        </div>

        <nav className="space-y-1 px-3 py-4">
          {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
            const active = pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                  active
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon size={16} />
                <span>{t(key)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 w-full space-y-3 px-4 pb-6">
          <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {t("warning_no_payment")}
          </div>

          <button
            onClick={() => setLanguage(language === "ja" ? "en" : "ja")}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 font-mono text-xs text-white/60 transition hover:border-white/20 hover:text-white"
          >
            <GlobeIcon size={12} />
            {t("language_toggle")}
          </button>
        </div>
      </aside>

      <main className="ml-[220px] min-h-screen bg-blue-50">
        <div className="min-h-screen px-6 py-8 lg:px-10">{children}</div>
      </main>
    </div>
  );
}

function GridIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function FileIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function LogIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function CogIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function GlobeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
