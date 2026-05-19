"use client";

import { userColor, userInitials, type AppUser } from "@/lib/hooks/useCurrentUser";

const USERS: AppUser[] = ["Naing", "Atsuki", "Aya"];

interface Props {
  onSelect: (user: AppUser) => void;
  current?: AppUser | null;
}

export default function UserPickerModal({ onSelect, current }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-1">SDC Invoice Tool</p>
          <h2 className="text-xl font-bold text-stone-900">Who are you?</h2>
          <p className="mt-1 text-sm text-stone-500">Select your name to get started</p>
        </div>

        <div className="space-y-3">
          {USERS.map((name) => (
            <button
              key={name}
              onClick={() => onSelect(name)}
              className={`w-full flex items-center gap-4 rounded-xl border-2 px-4 py-3.5 text-left transition-all
                ${current === name
                  ? "border-[#2d6a4f] bg-[#2d6a4f]/5"
                  : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"}`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: userColor(name) }}>
                {userInitials(name)}
              </span>
              <span className="font-semibold text-stone-800">{name}</span>
              {current === name && (
                <span className="ml-auto text-xs font-medium text-[#2d6a4f]">Current</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
