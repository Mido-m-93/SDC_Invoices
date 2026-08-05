// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications.tsx — App-wide notification bell state
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type NotificationKind = "info" | "success" | "error";

export interface Notification {
  id: number;
  kind: NotificationKind;
  message: string;
  timestamp: string;
  read: boolean;
}

interface NotificationsContextValue {
  notifications: Notification[];
  unreadCount: number;
  notify: (kind: NotificationKind, message: string) => void;
  markAllRead: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const MAX_NOTIFICATIONS = 50;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const notify = useCallback((kind: NotificationKind, message: string) => {
    setNotifications((prev) => {
      const id = prev.length > 0 ? prev[0].id + 1 : 0;
      const next: Notification = { id, kind, message, timestamp: new Date().toISOString(), read: false };
      return [next, ...prev].slice(0, MAX_NOTIFICATIONS);
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, notify, markAllRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationsProvider>");
  return ctx;
}
