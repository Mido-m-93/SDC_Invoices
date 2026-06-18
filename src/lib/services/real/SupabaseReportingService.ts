import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IReportingService } from "../types";
import type { ReportingKPIs } from "@/types";

export class SupabaseReportingService implements IReportingService {
  private get db() { return getSupabaseClient(); }

  async getKPIs(month: string): Promise<ReportingKPIs> {
    const db = this.db;
    const [leads, proposals, outbound, accounting, expenses, contracts, vendors] = await Promise.all([
      db.from("leads").select("stage, estimated_value, currency, created_at"),
      db.from("proposals").select("status"),
      db.from("outbound_invoices").select("status, total_amount, currency"),
      db.from("accounting_entries").select("type, amount_jpy, status").eq("month", month),
      db.from("expense_claims").select("status"),
      db.from("contracts").select("status"),
      db.from("vendors").select("status"),
    ]);

    const leadsData = (leads.data ?? []) as Array<{ stage: string; estimated_value: number }>;
    const leadsWon = leadsData.filter(l => l.stage === "won").length;
    const leadsLost = leadsData.filter(l => l.stage === "lost").length;

    const proposalsData = (proposals.data ?? []) as Array<{ status: string }>;
    const proposalsAccepted = proposalsData.filter(p => p.status === "accepted").length;

    const outboundData = (outbound.data ?? []) as Array<{ status: string; total_amount: number }>;
    const outboundPaid = outboundData.filter(o => o.status === "paid").length;
    const outboundOverdue = outboundData.filter(o => o.status === "overdue").length;
    const totalOutstandingJpy = outboundData.filter(o => !["paid","cancelled"].includes(o.status)).reduce((s, o) => s + (o.total_amount ?? 0), 0);

    const accData = (accounting.data ?? []) as Array<{ type: string; amount_jpy: number; status: string }>;
    const posted = accData.filter(e => e.status === "posted");
    const totalRevenueJpy = posted.filter(e => e.type === "revenue").reduce((s, e) => s + e.amount_jpy, 0);
    const totalExpensesJpy = posted.filter(e => e.type === "expense").reduce((s, e) => s + e.amount_jpy, 0);

    const expData = (expenses.data ?? []) as Array<{ status: string }>;
    const contractsData = (contracts.data ?? []) as Array<{ status: string }>;
    const vendorsData = (vendors.data ?? []) as Array<{ status: string }>;

    return {
      month,
      leadsTotal: leadsData.length, leadsWon, leadsLost,
      leadConversionRate: leadsData.length > 0 ? leadsWon / leadsData.length : 0,
      proposalsTotal: proposalsData.length, proposalsAccepted,
      proposalWinRate: proposalsData.length > 0 ? proposalsAccepted / proposalsData.length : 0,
      outboundInvoicesTotal: outboundData.length, outboundInvoicesPaid: outboundPaid, outboundInvoicesOverdue: outboundOverdue,
      invoiceCollectionRate: outboundData.length > 0 ? outboundPaid / outboundData.length : 0,
      totalOutstandingJpy,
      totalRevenueJpy, totalExpensesJpy,
      netProfitJpy: totalRevenueJpy - totalExpensesJpy,
      grossMarginPct: totalRevenueJpy > 0 ? ((totalRevenueJpy - totalExpensesJpy) / totalRevenueJpy) * 100 : 0,
      expensesTotal: expData.length,
      expensesApproved: expData.filter(e => e.status === "approved").length,
      expensesRejected: expData.filter(e => e.status === "rejected").length,
      activeVendors: vendorsData.filter(v => v.status === "active").length,
      activeContracts: contractsData.filter(c => c.status === "active").length,
      vendorsWithMissingInvoice: 0,
    };
  }
}
