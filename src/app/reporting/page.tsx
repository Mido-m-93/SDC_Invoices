"use client";

import AppShell from "@/components/layout/AppShell";
import { useState, useEffect, useCallback } from "react";
import type { ReportingKPIs } from "@/types";

function currentYearMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
}

function StatCard({ title, value, unit }: StatCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-white shadow-sm border border-stone-100 p-4">
      <span className="text-xs text-stone-500 uppercase tracking-wide">{title}</span>
      <span className="text-2xl font-bold text-stone-800 leading-tight">{value}</span>
      {unit && <span className="text-xs text-stone-400">{unit}</span>}
    </div>
  );
}

interface GroupProps {
  title: string;
  bg: string;
  children: React.ReactNode;
}

function Group({ title, bg, children }: GroupProps) {
  return (
    <section className={`rounded-2xl p-5 ${bg}`}>
      <h2 className="text-sm font-semibold text-stone-600 uppercase tracking-wider mb-3">
        {title}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {children}
      </div>
    </section>
  );
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function jpy(amount: number): string {
  return amount.toLocaleString();
}

export default function ReportingPage() {
  const [month, setMonth] = useState<string>(currentYearMonth());
  const [kpis, setKpis] = useState<ReportingKPIs | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKpis = useCallback(async (selectedMonth: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reporting/kpis?month=${selectedMonth}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch KPIs: ${res.status} ${res.statusText}`);
      }
      const data: ReportingKPIs = await res.json();
      setKpis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKpis(month);
  }, [month, fetchKpis]);

  return (
    <AppShell>
      <div className="min-h-screen bg-stone-50">
        {/* Header */}
        <div className="bg-[#1a3d2b] text-white px-6 py-6">
          <h1 className="text-2xl font-bold tracking-tight">Business Dashboard</h1>
          <p className="text-sm text-green-200 mt-1">
            Cross-entity KPIs: pipeline, proposals, collections, P&amp;L
          </p>
        </div>

        <div className="px-6 py-6 max-w-6xl mx-auto space-y-6">
          {/* Month selector */}
          <div className="flex items-center gap-3">
            <label htmlFor="month-select" className="text-sm font-medium text-stone-600">
              Month
            </label>
            <input
              id="month-select"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#1a3d2b]"
            />
            {loading && (
              <span className="text-xs text-stone-400 animate-pulse">Loading...</span>
            )}
          </div>

          {/* Error state */}
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* KPI groups */}
          {kpis && !loading && (
            <div className="space-y-5">
              {/* GROUP 1: Pipeline */}
              <Group title="Pipeline" bg="bg-blue-50">
                <StatCard title="Total Leads" value={kpis.leadsTotal} />
                <StatCard title="Won" value={kpis.leadsWon} />
                <StatCard title="Lost" value={kpis.leadsLost} />
                <StatCard title="Conversion Rate" value={pct(kpis.leadConversionRate)} />
              </Group>

              {/* GROUP 2: Proposals */}
              <Group title="Proposals" bg="bg-violet-50">
                <StatCard title="Total Proposals" value={kpis.proposalsTotal} />
                <StatCard title="Accepted" value={kpis.proposalsAccepted} />
                <StatCard title="Win Rate" value={pct(kpis.proposalWinRate)} />
              </Group>

              {/* GROUP 3: Invoice Collection */}
              <Group title="Invoice Collection" bg="bg-amber-50">
                <StatCard title="Total Outbound" value={kpis.outboundInvoicesTotal} />
                <StatCard title="Paid" value={kpis.outboundInvoicesPaid} />
                <StatCard title="Overdue" value={kpis.outboundInvoicesOverdue} />
                <StatCard title="Collection Rate" value={pct(kpis.invoiceCollectionRate)} />
                <StatCard title="Outstanding" value={jpy(kpis.totalOutstandingJpy)} unit="JPY" />
              </Group>

              {/* GROUP 4: P&L */}
              <Group title="P&L" bg="bg-green-50">
                <StatCard title="Total Revenue" value={jpy(kpis.totalRevenueJpy)} unit="JPY" />
                <StatCard title="Total Expenses" value={jpy(kpis.totalExpensesJpy)} unit="JPY" />
                <StatCard title="Net Profit" value={jpy(kpis.netProfitJpy)} unit="JPY" />
                <StatCard title="Gross Margin" value={pct(kpis.grossMarginPct)} />
              </Group>

              {/* GROUP 5: Expenses */}
              <Group title="Expenses" bg="bg-stone-50">
                <StatCard title="Total Claims" value={kpis.expensesTotal} />
                <StatCard title="Approved" value={kpis.expensesApproved} />
                <StatCard title="Rejected" value={kpis.expensesRejected} />
              </Group>

              {/* GROUP 6: Vendors & Contracts */}
              <Group title="Vendors &amp; Contracts" bg="bg-stone-50">
                <StatCard title="Active Vendors" value={kpis.activeVendors} />
                <StatCard title="Active Contracts" value={kpis.activeContracts} />
              </Group>
            </div>
          )}

          {/* Empty state */}
          {!kpis && !loading && !error && (
            <div className="text-center py-16 text-stone-400 text-sm">
              No data available for the selected month.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
