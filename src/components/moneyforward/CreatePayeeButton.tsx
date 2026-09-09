"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import {
  MfPayeeApiError,
  type MfBankDetailsInput,
  type CreateMfPayeeResult,
} from "@/lib/api/client";

const ACCOUNT_TYPES: MfBankDetailsInput["bankAccountType"][] = ["ordinary", "checking", "saving", "other"];

const EMPTY_FORM: MfBankDetailsInput = {
  bankAccountType: "ordinary",
  bankCode: "",
  bankBranchCode: "",
  accountNumber: "",
  holderName: "",
  holderNameKana: "",
};

interface Props {
  personName: string;
  existingPayeeId?: string | null;
  onCreate: (bankDetails?: MfBankDetailsInput) => Promise<CreateMfPayeeResult>;
  onCreated: (result: CreateMfPayeeResult) => void;
}

export default function CreatePayeeButton({ personName, existingPayeeId, onCreate, onCreated }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<MfBankDetailsInput>({ ...EMPTY_FORM });

  if (existingPayeeId) {
    return (
      <span className="text-xs text-emerald-600 whitespace-nowrap" title="Bank details on file, payee created in Money Forward Payables">
        🏦 Payee ready in MF
      </span>
    );
  }

  async function attemptCreate(bankDetails?: MfBankDetailsInput) {
    setLoading(true);
    setError(null);
    try {
      const result = await onCreate(bankDetails);
      setShowForm(false);
      onCreated(result);
    } catch (err) {
      if (err instanceof MfPayeeApiError && err.code === "NEEDS_BANK_DETAILS") {
        setShowForm(true);
        setError(null);
      } else if (err instanceof MfPayeeApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }

  const formValid =
    form.bankCode.trim() && form.bankBranchCode.trim() && form.accountNumber.trim() &&
    form.holderName.trim() && form.holderNameKana.trim();

  return (
    <>
      <div className="flex flex-col gap-1">
        <Button variant="ghost" size="sm" loading={loading} onClick={() => attemptCreate()}>
          🏦 Create Payee in MF
        </Button>
        {error && <p className="text-xs text-red-600 max-w-xs">{error}</p>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">Bank details for {personName}</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-700">×</button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <p className="text-xs text-stone-500">
                No bank details on file for {personName} yet. Enter them once — every future
                invoice or expense for this person will reuse the same Money Forward payee automatically.
              </p>

              <FormField label="Account type">
                <select
                  value={form.bankAccountType}
                  onChange={(e) => setForm({ ...form, bankAccountType: e.target.value as MfBankDetailsInput["bankAccountType"] })}
                  className="w-full rounded border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                >
                  {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Bank code (4 digits)">
                  <input
                    type="text"
                    value={form.bankCode}
                    onChange={(e) => setForm({ ...form, bankCode: e.target.value })}
                    placeholder="0001"
                    className="w-full rounded border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </FormField>
                <FormField label="Branch code (3 digits)">
                  <input
                    type="text"
                    value={form.bankBranchCode}
                    onChange={(e) => setForm({ ...form, bankBranchCode: e.target.value })}
                    placeholder="001"
                    className="w-full rounded border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </FormField>
              </div>

              <FormField label="Account number">
                <input
                  type="text"
                  value={form.accountNumber}
                  onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                  className="w-full rounded border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </FormField>

              <FormField label="Account holder name">
                <input
                  type="text"
                  value={form.holderName}
                  onChange={(e) => setForm({ ...form, holderName: e.target.value })}
                  placeholder="TARO YAMADA"
                  className="w-full rounded border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </FormField>

              <FormField label="Account holder name (half-width katakana)">
                <input
                  type="text"
                  value={form.holderNameKana}
                  onChange={(e) => setForm({ ...form, holderNameKana: e.target.value })}
                  placeholder="ﾀﾛｳ ﾔﾏﾀﾞ"
                  className="w-full rounded border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </FormField>

              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>

            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="text-xs text-stone-500 hover:text-stone-700 px-3 py-1.5">
                Cancel
              </button>
              <Button
                variant="primary"
                size="sm"
                loading={loading}
                disabled={!formValid}
                onClick={() => attemptCreate(form)}
              >
                Save &amp; Create Payee
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-stone-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
