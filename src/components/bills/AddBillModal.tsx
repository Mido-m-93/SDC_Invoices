"use client";
// src/components/bills/AddBillModal.tsx

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { FormField, formInput } from "@/components/ui/FormField";
import type { ToastKind } from "@/components/ui/Toast";

interface Counterparty { id: string; name: string; code: string }
interface InvoiceReport { id: string; title: string; status: string }
interface NamedOption { id: string; name?: string; code?: string }

interface Props {
  language: string;
  onClose: () => void;
  onNotify: (kind: ToastKind, message: string) => void;
  onCreated: () => void;
}

function label(o: NamedOption): string {
  return o.name ?? o.code ?? o.id;
}

export default function AddBillModal({ language, onClose, onNotify, onCreated }: Props) {
  const ja = language === "ja";

  const [loadingOptions, setLoadingOptions] = useState(true);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [invoiceReports, setInvoiceReports] = useState<InvoiceReport[]>([]);
  const [exItems, setExItems] = useState<NamedOption[]>([]);

  const [counterpartyId, setCounterpartyId] = useState("");
  const [payees, setPayees] = useState<NamedOption[]>([]);
  const [loadingPayees, setLoadingPayees] = useState(false);
  const [payeeId, setPayeeId] = useState("");
  const [invoiceReportId, setInvoiceReportId] = useState("");
  const [exItemId, setExItemId] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dealDate, setDealDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  // Load counterparties / invoice reports / expense items once, on open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bills");
        const data = await res.json().catch(() => ({})) as {
          counterparties?: Counterparty[]; invoiceReports?: InvoiceReport[]; exItems?: NamedOption[]; error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        setCounterparties(data.counterparties ?? []);
        setInvoiceReports((data.invoiceReports ?? []).filter((r) => r.status !== "closed"));
        setExItems(data.exItems ?? []);
      } catch (err) {
        if (!cancelled) onNotify("error", ja ? `選択肢の読み込みに失敗しました: ${String(err)}` : `Failed to load bill options: ${String(err)}`);
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cascading load: payees for the selected counterparty.
  useEffect(() => {
    setPayeeId("");
    if (!counterpartyId) { setPayees([]); return; }
    let cancelled = false;
    setLoadingPayees(true);
    (async () => {
      try {
        const res = await fetch(`/api/bills/payees?counterpartyId=${encodeURIComponent(counterpartyId)}`);
        const data = await res.json().catch(() => ({})) as { payees?: NamedOption[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!cancelled) setPayees(data.payees ?? []);
      } catch (err) {
        if (!cancelled) onNotify("error", ja ? `支払先の読み込みに失敗しました: ${String(err)}` : `Failed to load payees: ${String(err)}`);
      } finally {
        if (!cancelled) setLoadingPayees(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counterpartyId]);

  const canSubmit =
    !submitting && !!payeeId && !!invoiceReportId && !!exItemId &&
    name.trim().length > 0 && Number(amount) > 0 && !!dealDate;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    onNotify("info", ja ? "請求書を作成しています…" : "Creating bill…");
    try {
      const res = await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterpartyId, payeeId, invoiceReportId, exItemId,
          name: name.trim(), totalValue: Number(amount), dealDate,
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onNotify("success", ja ? "請求書を作成しました" : "Bill created successfully");
      onCreated();
      onClose();
    } catch (err) {
      onNotify("error", ja ? `作成に失敗しました: ${String(err)}` : `Failed to create bill: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-800">{ja ? "請求書を追加" : "Add Bill"}</h2>
          <button onClick={onClose} className="text-lg leading-none text-stone-400 hover:text-stone-600">×</button>
        </div>

        {loadingOptions ? (
          <div className="flex h-32 items-center justify-center text-sm text-stone-400">
            {ja ? "読み込み中…" : "Loading…"}
          </div>
        ) : (
          <div className="space-y-3">
            <FormField label={ja ? "取引先" : "Counterparty"}>
              <select className={formInput} value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                <option value="">{ja ? "選択してください" : "Select…"}</option>
                {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>

            <FormField label={ja ? "支払先" : "Payee"}>
              <select
                className={formInput}
                value={payeeId}
                onChange={(e) => setPayeeId(e.target.value)}
                disabled={!counterpartyId || loadingPayees}
              >
                <option value="">
                  {loadingPayees ? (ja ? "読み込み中…" : "Loading…") : (ja ? "選択してください" : "Select…")}
                </option>
                {payees.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
              </select>
            </FormField>

            <FormField label={ja ? "支払依頼" : "Invoice Report"}>
              <select className={formInput} value={invoiceReportId} onChange={(e) => setInvoiceReportId(e.target.value)}>
                <option value="">{ja ? "選択してください" : "Select…"}</option>
                {invoiceReports.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            </FormField>

            <FormField label={ja ? "勘定科目" : "Expense Item"}>
              <select className={formInput} value={exItemId} onChange={(e) => setExItemId(e.target.value)}>
                <option value="">{ja ? "選択してください" : "Select…"}</option>
                {exItems.map((i) => <option key={i.id} value={i.id}>{label(i)}</option>)}
              </select>
            </FormField>

            <FormField label={ja ? "件名" : "Description"}>
              <input
                className={formInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={ja ? "例: 4月分サーバー費用" : "e.g. April server costs"}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label={ja ? "金額" : "Amount"}>
                <input type="number" min="1" className={formInput} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </FormField>
              <FormField label={ja ? "取引日" : "Deal Date"}>
                <input type="date" className={formInput} value={dealDate} onChange={(e) => setDealDate(e.target.value)} />
              </FormField>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={onClose}>{ja ? "キャンセル" : "Cancel"}</Button>
              <Button variant="primary" size="sm" loading={submitting} disabled={!canSubmit} onClick={handleSubmit}>
                {ja ? "作成" : "Create Bill"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
