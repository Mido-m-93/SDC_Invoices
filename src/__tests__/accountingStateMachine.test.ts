// ─────────────────────────────────────────────────────────────────────────────
// accountingStateMachine.test.ts
//
// Tests for the accounting entry state machine enforced by MockAccountingService.
//
// Valid transitions:
//   draft  → posted   (via postEntry)
//   posted → voided   (via voidEntry)
//
// Invalid / guarded transitions:
//   voided → posted   must be rejected
//   draft  → voided   must be rejected (only posted entries can be voided)
//
// MockAccountingService lives in src/lib/services/mock/index.ts and uses a
// plain in-memory Map — no Next.js or server-only imports needed here.
// ─────────────────────────────────────────────────────────────────────────────

import { MockAccountingService } from "@/lib/services/mock/index";
import type { AccountingEntry } from "@/types";

// ── Helper ────────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<AccountingEntry> = {}): AccountingEntry {
  return {
    id: "entry-test-1",
    entryDate: "2026-05-01",
    month: "2026-05",
    type: "revenue",
    category: "consulting",
    description: "Test entry",
    amount: 100_000,
    currency: "JPY",
    exchangeRate: 1,
    amountJpy: 100_000,
    status: "draft",
    sourceType: "manual",
    sourceId: "",
    clientId: "client-1",
    vendorId: "",
    memberId: "",
    notes: "",
    postedBy: "",
    postedAt: null,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MockAccountingService — state machine", () => {
  let svc: MockAccountingService;

  beforeEach(() => {
    svc = new MockAccountingService();
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("cannot post a voided entry — postEntry should throw or leave status unchanged", async () => {
    // Arrange — save an entry that is already voided
    const entry = makeEntry({ id: "voided-entry", status: "voided" });
    await svc.saveEntry(entry);

    // Act — attempt to post it
    let threw = false;
    try {
      await svc.postEntry("voided-entry", "actor");
    } catch {
      threw = true;
    }

    // Assert — either an error was thrown, or the entry was NOT transitioned
    const after = await svc.getEntry("voided-entry");
    if (!threw) {
      // Implementation must have guarded the transition silently
      expect(after?.status).toBe("voided");
    } else {
      // An explicit error is also acceptable
      expect(threw).toBe(true);
    }
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("cannot void a draft entry directly — only posted entries should be voidable", async () => {
    // Arrange — save a draft entry
    const entry = makeEntry({ id: "draft-entry", status: "draft" });
    await svc.saveEntry(entry);

    // Act — attempt to void it directly (skipping the post step)
    let threw = false;
    try {
      await svc.voidEntry("draft-entry", "actor");
    } catch {
      threw = true;
    }

    // Assert — either an error was thrown, or the entry was NOT transitioned
    const after = await svc.getEntry("draft-entry");
    if (!threw) {
      // Implementation must have guarded the transition silently
      expect(after?.status).toBe("draft");
    } else {
      expect(threw).toBe(true);
    }
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it("posting a draft entry sets status to 'posted' and records postedBy", async () => {
    // Arrange
    const entry = makeEntry({ id: "draft-to-post", status: "draft" });
    await svc.saveEntry(entry);

    // Act
    await svc.postEntry("draft-to-post", "Jane Doe");

    // Assert
    const after = await svc.getEntry("draft-to-post");
    expect(after).not.toBeNull();
    expect(after!.status).toBe("posted");
    expect(after!.postedBy).toBe("Jane Doe");
    expect(after!.postedAt).not.toBeNull();
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it("voiding a posted entry sets status to 'voided'", async () => {
    // Arrange — post an entry first, then void it
    const entry = makeEntry({ id: "posted-to-void", status: "draft" });
    await svc.saveEntry(entry);
    await svc.postEntry("posted-to-void", "Jane Doe");

    // Confirm it is posted before voiding
    const posted = await svc.getEntry("posted-to-void");
    expect(posted?.status).toBe("posted");

    // Act
    await svc.voidEntry("posted-to-void", "Jane Doe");

    // Assert
    const after = await svc.getEntry("posted-to-void");
    expect(after).not.toBeNull();
    expect(after!.status).toBe("voided");
  });
});
