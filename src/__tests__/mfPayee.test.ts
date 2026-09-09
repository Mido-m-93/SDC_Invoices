// ─────────────────────────────────────────────────────────────────────────────
// __tests__/mfPayee.test.ts
//
// Integration tests for createOrReusePayeeForMember (src/lib/services/real/mfPayee.ts).
//
// Strategy (Robo Co-op principle: no mock abuse):
//   - The member service is a boundary (injected via getMemberService()) —
//     mocked here with a small in-memory fake that implements IMemberService.
//   - MoneyForwardPayablesService is the real external-API boundary (OAuth +
//     HTTP calls to Money Forward) — mocked at the class/module level.
//   - Everything else (the branching logic in createOrReusePayeeForMember
//     itself: name lookup, email fallback, reuse-vs-create, bank details
//     validation) runs for real, unmocked.
//
// What is NOT tested here:
//   - SupabaseMemberService.getMemberByName / getMemberByEmail against a real
//     Supabase instance (needs a live/containerised DB — integration/e2e scope).
//   - The two Next.js route handlers
//     (src/app/api/invoices/create-mf-payee/route.ts,
//      src/app/api/expenses/[id]/create-mf-payee/route.ts) — these need a
//     NextRequest/route-handler test harness that isn't set up in this repo
//     yet; flagged as a follow-up.
//   - MoneyForwardPayablesService's own OAuth/token-refresh logic — that's a
//     separate unit with its own boundary (HTTP + token file), not exercised
//     here beyond a mocked createPayeeWithBankAccount() call.
// ─────────────────────────────────────────────────────────────────────────────

import type { Member } from "@/types";
import type { IMemberService } from "@/lib/services/types";

// ── Boundary 1: member service factory ──────────────────────────────────────

let memberStore: Member[] = [];

function makeFakeMemberService(): IMemberService {
  return {
    async listMembers() {
      return [...memberStore];
    },
    async getMember(id: string) {
      return memberStore.find((m) => m.id === id) ?? null;
    },
    async getMemberByEmail(email: string) {
      return memberStore.find((m) => m.email.toLowerCase() === email.toLowerCase()) ?? null;
    },
    async getMemberByName(displayName: string) {
      const target = displayName.trim().toLowerCase();
      return memberStore.find((m) => m.displayName.trim().toLowerCase() === target) ?? null;
    },
    async saveMember(member: Member) {
      const idx = memberStore.findIndex((m) => m.id === member.id);
      if (idx >= 0) memberStore[idx] = member;
      else memberStore.push(member);
    },
    async deleteMember(id: string) {
      memberStore = memberStore.filter((m) => m.id !== id);
    },
  };
}

jest.mock("@/lib/services", () => ({
  getMemberService: () => makeFakeMemberService(),
}));

// ── Boundary 2: external Money Forward Payables API ─────────────────────────

const createPayeeWithBankAccount = jest.fn();

jest.mock("@/lib/services/real/MoneyForwardPayablesService", () => ({
  MoneyForwardPayablesService: jest.fn().mockImplementation(() => ({
    createPayeeWithBankAccount,
  })),
}));

// Import AFTER jest.mock so the mocks are in place.
import {
  createOrReusePayeeForMember,
  MemberNotFoundError,
  NeedsBankDetailsError,
  type BankDetailsInput,
} from "@/lib/services/real/mfPayee";

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: "member-1",
    displayName: "Carol Smith",
    email: "carol@sdc.co.jp",
    phone: "090-0000-0002",
    role: "engineer",
    department: "Development",
    employeeCode: "EMP-001",
    joinDate: "2025-04-01",
    status: "active",
    avatarUrl: "",
    notes: "",
    createdAt: "2025-04-01T00:00:00Z",
    updatedAt: "2025-04-01T00:00:00Z",
    ...overrides,
  } as Member;
}

const bankDetails: BankDetailsInput = {
  bankAccountType: "ordinary",
  bankCode: "0001",
  bankBranchCode: "001",
  accountNumber: "1234567",
  holderName: "CAROL SMITH",
  holderNameKana: "キャロル スミス",
};

beforeEach(() => {
  memberStore = [];
  createPayeeWithBankAccount.mockReset();
  createPayeeWithBankAccount.mockResolvedValue({
    counterpartyId: "cp-1",
    counterpartyAccountId: "cpa-1",
    payeeId: "payee-1",
  });
});

describe("createOrReusePayeeForMember", () => {
  // Happy path ───────────────────────────────────────────────────────────────

  it("matches by name and creates a new payee when bank details are supplied", async () => {
    memberStore.push(makeMember());

    const result = await createOrReusePayeeForMember("Carol Smith", bankDetails);

    expect(result.reused).toBe(false);
    expect(result.payeeId).toBe("payee-1");
    expect(result.counterpartyId).toBe("cp-1");
    expect(createPayeeWithBankAccount).toHaveBeenCalledTimes(1);

    const stored = memberStore.find((m) => m.id === "member-1");
    expect(stored?.mfPayeeId).toBe("payee-1");
    expect(stored?.mfCounterpartyId).toBe("cp-1");
    expect(stored?.bankCode).toBe("0001");
  });

  it("reuses an existing payee without calling the MF API again", async () => {
    memberStore.push(
      makeMember({
        mfPayeeId: "existing-payee",
        mfCounterpartyId: "existing-cp",
        mfPayeeCreatedAt: "2026-01-01T00:00:00Z",
      })
    );

    const result = await createOrReusePayeeForMember("Carol Smith");

    expect(result.reused).toBe(true);
    expect(result.payeeId).toBe("existing-payee");
    expect(result.counterpartyId).toBe("existing-cp");
    expect(createPayeeWithBankAccount).not.toHaveBeenCalled();
  });

  // Email fallback (the fix under review) ───────────────────────────────────

  it("falls back to email lookup when the name match misses", async () => {
    // Member's displayName differs from the (bad) name on the submission,
    // e.g. submittedBy mistakenly held an email address instead of a name.
    memberStore.push(makeMember({ displayName: "Carol Smith", email: "carol@sdc.co.jp" }));

    const result = await createOrReusePayeeForMember(
      "carol@sdc.co.jp", // name lookup will miss
      bankDetails,
      "carol@sdc.co.jp" // email fallback hits
    );

    expect(result.payeeId).toBe("payee-1");
  });

  it("prefers the name match over the email fallback when both would resolve to different members", async () => {
    memberStore.push(makeMember({ id: "member-1", displayName: "Carol Smith", email: "carol@sdc.co.jp" }));
    memberStore.push(makeMember({ id: "member-2", displayName: "Dana Lee", email: "dana@sdc.co.jp" }));

    const result = await createOrReusePayeeForMember("Carol Smith", bankDetails, "dana@sdc.co.jp");

    // Should resolve via name match (member-1), not the email fallback (member-2).
    expect(createPayeeWithBankAccount).toHaveBeenCalledWith(
      expect.objectContaining({ counterpartyName: "Carol Smith" })
    );
    void result;
  });

  // Error paths ──────────────────────────────────────────────────────────────

  it("throws MemberNotFoundError when both name and email fallback miss", async () => {
    memberStore.push(makeMember({ displayName: "Someone Else", email: "someone@sdc.co.jp" }));

    await expect(
      createOrReusePayeeForMember("Unknown Person", bankDetails, "unknown@sdc.co.jp")
    ).rejects.toThrow(MemberNotFoundError);
    expect(createPayeeWithBankAccount).not.toHaveBeenCalled();
  });

  it("throws MemberNotFoundError when name misses and no email was supplied", async () => {
    await expect(createOrReusePayeeForMember("Unknown Person")).rejects.toThrow(MemberNotFoundError);
  });

  it("throws NeedsBankDetailsError when the member has no bank details and none were supplied", async () => {
    memberStore.push(makeMember());

    await expect(createOrReusePayeeForMember("Carol Smith")).rejects.toThrow(NeedsBankDetailsError);
    expect(createPayeeWithBankAccount).not.toHaveBeenCalled();
  });

  // Side effects ─────────────────────────────────────────────────────────────

  it("persists bank details onto the member record before calling the MF API", async () => {
    memberStore.push(makeMember());

    await createOrReusePayeeForMember("Carol Smith", bankDetails);

    // saveMember is called twice: once to persist bank details, once to persist
    // the resulting MF ids. Verify the final stored state has both.
    const stored = memberStore.find((m) => m.id === "member-1");
    expect(stored?.bankHolderNameKana).toBe("キャロル スミス");
    expect(stored?.mfPayeeId).toBe("payee-1");
  });
});
