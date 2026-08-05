"use client";
// src/components/ui/Toast.tsx

import { useCallback, useRef, useState } from "react";

export type ToastKind = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const AUTO_DISMISS_MS: Record<ToastKind, number> = {
  info: 3500,
  success: 3500,
  error: 6000,
};

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS[kind]);
    return id;
  }, [dismiss]);

  return { toasts, push, dismiss };
}

const KIND_CLASSES: Record<ToastKind, string> = {
  info: "bg-stone-800 text-white",
  success: "bg-emerald-600 text-white",
  error: "bg-red-600 text-white",
};

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 ${KIND_CLASSES[toast.kind]}`}
        >
          <span className="break-words">{toast.message}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 text-lg leading-none text-white/70 hover:text-white"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
