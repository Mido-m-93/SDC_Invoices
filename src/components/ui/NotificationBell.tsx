"use client";
// src/components/ui/NotificationBell.tsx

import { useEffect, useRef, useState } from "react";
import { useNotifications, type NotificationKind } from "@/lib/notifications";
import { useLanguage } from "@/translations";
import { formatTimestamp } from "@/lib/utils";

const DOT_CLASSES: Record<NotificationKind, string> = {
  info: "bg-stone-400",
  success: "bg-emerald-500",
  error: "bg-red-500",
};

export default function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      if (next) markAllRead();
      return next;
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
        title={language === "ja" ? "通知" : "Notifications"}
      >
        <BellIcon size={16} />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-2 w-2 items-center justify-center rounded-full bg-red-500" />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-xl border border-stone-200 bg-white text-stone-900 shadow-xl">
          <div className="border-b border-stone-100 px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              {language === "ja" ? "通知" : "Notifications"}
            </p>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-stone-400">
                {language === "ja" ? "通知はまだありません" : "No notifications yet"}
              </p>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className="flex items-start gap-2.5 border-b border-stone-50 px-4 py-3 last:border-0">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[n.kind]}`} />
                  <div className="min-w-0">
                    <p className="text-xs text-stone-700">{n.message}</p>
                    <p className="mt-0.5 text-[10px] text-stone-400">{formatTimestamp(n.timestamp, language)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
