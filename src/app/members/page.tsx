"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import type { Member, MemberRole, MemberStatus } from "@/types";
import { generateId } from "@/lib/utils";

const EMPTY_MEMBER: Omit<Member, "id" | "createdAt" | "updatedAt" | "avatarUrl"> = {
  displayName: "",
  email: "",
  phone: "",
  role: "other",
  department: "",
  employeeCode: "",
  joinDate: "",
  status: "active",
  notes: "",
};

const ROLE_COLORS: Record<MemberRole, string> = {
  admin:      "bg-red-100 text-red-700",
  sales:      "bg-blue-100 text-blue-700",
  accounting: "bg-green-100 text-green-700",
  engineer:   "bg-indigo-100 text-indigo-700",
  designer:   "bg-violet-100 text-violet-700",
  manager:    "bg-amber-100 text-amber-700",
  other:      "bg-stone-100 text-stone-600",
};

const STATUS_COLORS: Record<MemberStatus, string> = {
  active:   "bg-green-100 text-green-700",
  inactive: "bg-stone-100 text-stone-500",
  on_leave: "bg-amber-100 text-amber-700",
};

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_MEMBER });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/members");
      const data = await res.json() as { members: Member[] };
      setMembers(data.members ?? []);
    } catch {
      setError("Failed to load members");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_MEMBER });
    setShowForm(true);
  }

  function openEdit(m: Member) {
    setEditing(m);
    const { id: _id, createdAt: _c, updatedAt: _u, avatarUrl: _a, ...rest } = m;
    setForm(rest);
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editing) {
        await fetch(`/api/members/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      } else {
        await fetch("/api/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, id: generateId("mbr") }),
        });
      }
      setShowForm(false);
      load();
    } catch {
      setError("Failed to save member");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this member?")) return;
    await fetch(`/api/members/${id}`, { method: "DELETE" });
    load();
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <AppShell>
      <PageHeader
        title="Team Members"
        subtitle="Internal members and contractors"
        actions={
          <Button variant="primary" onClick={openNew}
            className="bg-[#1a3d2b] hover:bg-[#1a3d2b]/90 text-white">
            + Add Member
          </Button>
        }
      />

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : members.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">No members registered yet.</p>
          <Button variant="primary" className="mt-4 bg-[#1a3d2b] hover:bg-[#1a3d2b]/90 text-white" onClick={openNew}>
            Add your first member
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Department</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Join Date</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">
                    {m.displayName}
                    {m.employeeCode && (
                      <span className="ml-2 text-xs text-stone-400 font-mono">{m.employeeCode}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-600">{m.email || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[m.role]}`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-500">{m.department || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[m.status]}`}>
                      {m.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-500 font-mono">{m.joinDate || "—"}</td>
                  <td className="px-4 py-3 flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(m.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">{editing ? "Edit Member" : "Add Member"}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label="Display Name *">
                <input
                  className={input}
                  value={form.displayName}
                  onChange={(e) => set("displayName", e.target.value)}
                  placeholder="Full name"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email">
                  <input
                    type="email"
                    className={input}
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="name@example.com"
                  />
                </Field>
                <Field label="Phone">
                  <input
                    className={input}
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="+81 90-0000-0000"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Role *">
                  <select
                    className={input}
                    value={form.role}
                    onChange={(e) => set("role", e.target.value as MemberRole)}
                  >
                    <option value="admin">Admin</option>
                    <option value="sales">Sales</option>
                    <option value="accounting">Accounting</option>
                    <option value="engineer">Engineer</option>
                    <option value="designer">Designer</option>
                    <option value="manager">Manager</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Department">
                  <input
                    className={input}
                    value={form.department}
                    onChange={(e) => set("department", e.target.value)}
                    placeholder="e.g. Engineering"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Employee Code">
                  <input
                    className={input}
                    value={form.employeeCode}
                    onChange={(e) => set("employeeCode", e.target.value)}
                    placeholder="EMP-001"
                  />
                </Field>
                <Field label="Join Date">
                  <input
                    type="date"
                    className={input}
                    value={form.joinDate}
                    onChange={(e) => set("joinDate", e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Status">
                <select
                  className={input}
                  value={form.status}
                  onChange={(e) => set("status", e.target.value as MemberStatus)}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="on_leave">On Leave</option>
                </select>
              </Field>
              <Field label="Notes">
                <textarea
                  className={`${input} resize-none`}
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Additional notes…"
                />
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={saving}
                onClick={handleSave}
                className="bg-[#1a3d2b] hover:bg-[#1a3d2b]/90 text-white"
              >
                Save Member
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const input = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
