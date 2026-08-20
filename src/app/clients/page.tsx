"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useLanguage, type TranslationKey } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import type { Client } from "@/types";
import { generateId } from "@/lib/utils";

const EMPTY_CLIENT: Omit<Client, "id" | "createdAt" | "updatedAt"> = {
  name: "",
  legalName: "",
  industry: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  address: "",
  country: "JP",
  taxRegistrationNumber: "",
  status: "prospect",
  notes: "",
};

export default function ClientsPage() {
  const { t } = useLanguage();
  const { notify } = useNotifications();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_CLIENT });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clients");
      const data = await res.json() as { clients: Client[] };
      setClients(data.clients ?? []);
    } catch {
      setError(t("clients_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_CLIENT });
    setShowForm(true);
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({ ...c });
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = editing ? `/api/clients/${editing.id}` : "/api/clients";
      const method = editing ? "PUT" : "POST";
      const body = editing
        ? { ...form }
        : { ...form, id: generateId("cli"), createdAt: new Date().toISOString() };
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setShowForm(false);
      notify("success", editing ? `Updated client ${form.name}` : `Added client ${form.name}`, "/clients");
      load();
    } catch {
      setError(t("clients_save_failed"));
      notify("error", `Failed to save client ${form.name}`, "/clients");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("clients_delete_confirm"))) return;
    const target = clients.find((c) => c.id === id);
    try {
      await fetch(`/api/clients/${id}`, { method: "DELETE" });
      notify("success", `Deleted client ${target?.name ?? id}`, "/clients");
      load();
    } catch (err) {
      setError(t("clients_save_failed"));
      notify("error", `Failed to delete client ${target?.name ?? id}: ${String(err)}`, "/clients");
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <AppShell>
      <PageHeader
        title={t("clients_title")}
        subtitle={t("clients_subtitle")}
        actions={
          <Button variant="primary" onClick={openNew}>
            {t("clients_add")}
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
        <p className="text-sm text-stone-400">{t("loading")}</p>
      ) : clients.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("clients_empty_title")}</p>
          <Button variant="primary" className="mt-4" onClick={openNew}>{t("clients_empty_cta")}</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">{t("clients_col_name")}</th>
                <th className="px-4 py-3 text-left">{t("clients_col_industry")}</th>
                <th className="px-4 py-3 text-left">{t("clients_col_contact")}</th>
                <th className="px-4 py-3 text-left">{t("clients_col_email")}</th>
                <th className="px-4 py-3 text-left">{t("clients_col_status")}</th>
                <th className="px-4 py-3 text-left">{t("clients_col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">{c.name}</td>
                  <td className="px-4 py-3 text-stone-600">{c.industry || "—"}</td>
                  <td className="px-4 py-3 text-stone-600">{c.contactName || "—"}</td>
                  <td className="px-4 py-3 text-stone-500 text-xs">{c.contactEmail || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.status === "active"   ? "bg-green-100 text-green-700" :
                      c.status === "inactive" ? "bg-stone-100 text-stone-500" :
                      "bg-blue-100 text-blue-700"
                    }`}>
                      {t(`clients_status_${c.status}` as TranslationKey)}
                    </span>
                  </td>
                  <td className="px-4 py-3 flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>{t("clients_action_edit")}</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)}>{t("clients_action_delete")}</Button>
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
              <h2 className="text-base font-semibold">{editing ? t("clients_modal_edit_title") : t("clients_modal_new_title")}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label={t("clients_field_name")}>
                <input
                  className={input}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder={t("clients_field_name_placeholder")}
                />
              </Field>
              <Field label={t("clients_field_legal_name")}>
                <input
                  className={input}
                  value={form.legalName}
                  onChange={(e) => set("legalName", e.target.value)}
                  placeholder={t("clients_field_legal_name_placeholder")}
                />
              </Field>
              <Field label={t("clients_field_industry")}>
                <input
                  className={input}
                  value={form.industry}
                  onChange={(e) => set("industry", e.target.value)}
                  placeholder={t("clients_field_industry_placeholder")}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("clients_field_contact_name")}>
                  <input
                    className={input}
                    value={form.contactName}
                    onChange={(e) => set("contactName", e.target.value)}
                    placeholder={t("clients_field_contact_name_placeholder")}
                  />
                </Field>
                <Field label={t("clients_field_contact_email")}>
                  <input
                    type="email"
                    className={input}
                    value={form.contactEmail}
                    onChange={(e) => set("contactEmail", e.target.value)}
                    placeholder={t("clients_field_contact_email_placeholder")}
                  />
                </Field>
              </div>
              <Field label={t("clients_field_contact_phone")}>
                <input
                  className={input}
                  value={form.contactPhone}
                  onChange={(e) => set("contactPhone", e.target.value)}
                  placeholder={t("clients_field_contact_phone_placeholder")}
                />
              </Field>
              <Field label={t("clients_field_address")}>
                <input
                  className={input}
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder={t("clients_field_address_placeholder")}
                />
              </Field>
              <Field label={t("clients_field_country")}>
                <input
                  className={input}
                  value={form.country}
                  onChange={(e) => set("country", e.target.value)}
                  placeholder={t("clients_field_country_placeholder")}
                />
              </Field>
              <Field label={t("clients_field_tax_reg_number")}>
                <input
                  className={input}
                  value={form.taxRegistrationNumber}
                  onChange={(e) => set("taxRegistrationNumber", e.target.value)}
                  placeholder={t("clients_field_tax_reg_number_placeholder")}
                />
              </Field>
              <Field label={t("clients_field_status")}>
                <select
                  className={input}
                  value={form.status}
                  onChange={(e) => set("status", e.target.value as Client["status"])}
                >
                  <option value="prospect">{t("clients_status_prospect")}</option>
                  <option value="active">{t("clients_status_active")}</option>
                  <option value="inactive">{t("clients_status_inactive")}</option>
                </select>
              </Field>
              <Field label={t("clients_field_notes")}>
                <textarea
                  className={`${input} resize-none`}
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder={t("clients_field_notes_placeholder")}
                />
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
              <Button
                variant="primary"
                loading={saving}
                onClick={handleSave}
                className="bg-[#1a3d2b] hover:bg-[#14321f]"
              >
                {t("clients_save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const input =
  "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
