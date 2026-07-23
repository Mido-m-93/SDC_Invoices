import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IMemberService } from "../types";
import type { Member, MemberStatus } from "@/types";

function toRow(m: Member): Record<string, unknown> {
  return { id: m.id, display_name: m.displayName, email: m.email, phone: m.phone, role: m.role, department: m.department, employee_code: m.employeeCode, join_date: m.joinDate, status: m.status, avatar_url: m.avatarUrl, notes: m.notes, created_at: m.createdAt, updated_at: m.updatedAt, contract_start: m.contractStart ?? null, contract_end: m.contractEnd ?? null, contracted_amount: m.contractedAmount ?? null, contract_scope: m.contractScope ?? null };
}

function fromRow(r: Record<string, unknown>): Member {
  return { id: r.id as string, displayName: r.display_name as string, email: r.email as string, phone: r.phone as string, role: r.role as Member["role"], department: r.department as string, employeeCode: r.employee_code as string, joinDate: r.join_date as string, status: r.status as MemberStatus, avatarUrl: r.avatar_url as string, notes: r.notes as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string, contractStart: (r.contract_start as string) ?? null, contractEnd: (r.contract_end as string) ?? null, contractedAmount: (r.contracted_amount as number) ?? null, contractScope: (r.contract_scope as string) ?? null };
}

export class SupabaseMemberService implements IMemberService {
  private get db() { return getSupabaseClient(); }

  async listMembers(filters?: { status?: MemberStatus; role?: string }): Promise<Member[]> {
    let q = this.db.from("members").select("*").order("display_name", { ascending: true });
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.role) q = q.eq("role", filters.role);
    const { data, error } = await q;
    if (error) throw new Error(`listMembers: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async getMember(id: string): Promise<Member | null> {
    const { data, error } = await this.db.from("members").select("*").eq("id", id).single();
    if (error) return null;
    return fromRow(data as Record<string, unknown>);
  }

  async saveMember(member: Member): Promise<void> {
    const { error } = await this.db.from("members").upsert(toRow(member), { onConflict: "id" });
    if (error) throw new Error(`saveMember: ${error.message}`);
  }

  async deleteMember(id: string): Promise<void> {
    const { error } = await this.db.from("members").delete().eq("id", id);
    if (error) throw new Error(`deleteMember: ${error.message}`);
  }
}
