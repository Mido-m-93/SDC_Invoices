"use client";
// src/components/ui/ClientPicker.tsx

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { Client } from "@/types";

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
  placeholder = "Search or type a new client name…",
  createEndpoint = "/api/clients",
}: ClientPickerProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        placeholder={placeholder}
        value={clientName}
        onChange={(e) => {
          onChange("", e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {clientId && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-emerald-600" title="Linked to a client record">
          ✓ linked
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
              {query ? "No matching clients." : "No clients yet — type a name to create one."}
            </div>
          )}
          {query && !exactMatch && (
            <button
              type="button"
              className="block w-full text-left px-3 py-2 text-emerald-700 hover:bg-emerald-50 border-t border-stone-100 disabled:opacity-50"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? "Creating…" : `+ Create client "${clientName.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
