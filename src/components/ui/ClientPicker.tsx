"use client";
// src/components/ui/ClientPicker.tsx

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { Client } from "@/types";
import { useLanguage } from "@/translations";

interface ClientPickerProps {
  clients: Client[];
  clientId: string;
  clientName: string;
  onChange: (clientId: string, clientName: string) => void;
  onClientCreated: (client: Client) => void;
  className?: string;
  placeholder?: string;
  createEndpoint?: string;
}

export default function ClientPicker({
  clients,
  clientId,
  clientName,
  onChange,
  onClientCreated,
  className,
  placeholder,
  createEndpoint = "/api/clients",
}: ClientPickerProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const resolvedPlaceholder = placeholder ?? t("client_picker_placeholder");

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const query = clientName.trim().toLowerCase();
  const matches = query ? clients.filter((c) => c.name.toLowerCase().includes(query)) : clients;
  const exactMatch = clients.some((c) => c.name.toLowerCase() === query);

  async function handleCreate() {
    const name = clientName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await fetch(createEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, status: "prospect" }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { client: Client };
      onClientCreated(data.client);
      onChange(data.client.id, data.client.name);
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        className={className}
        placeholder={resolvedPlaceholder}
        value={clientName}
        onChange={(e) => {
          onChange("", e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {clientId && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-emerald-600" title={t("client_picker_linked_title")}>
          {t("client_picker_linked_badge")}
        </span>
      )}
      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg text-sm">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              className={clsx(
                "block w-full text-left px-3 py-2 hover:bg-stone-50",
                c.id === clientId && "bg-stone-50 font-medium"
              )}
              onClick={() => {
                onChange(c.id, c.name);
                setOpen(false);
              }}
            >
              {c.name}
            </button>
          ))}
          {matches.length === 0 && (
            <div className="px-3 py-2 text-stone-400">
              {query ? t("client_picker_no_matches") : t("client_picker_empty")}
            </div>
          )}
          {query && !exactMatch && (
            <button
              type="button"
              className="block w-full text-left px-3 py-2 text-emerald-700 hover:bg-emerald-50 border-t border-stone-100 disabled:opacity-50"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? t("client_picker_creating") : t("client_picker_create_button").replace("{name}", clientName.trim())}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
