// DELETE /api/trash/[id]  — purge one item permanently
// POST   /api/trash/[id]  — restore one item back to its original collection

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  getTrashService,
  getStorageService,
  getExpenseService,
  getProposalService,
  getClientService,
  getLeadService,
} from "@/lib/services";
import type {
  InvoiceSubmission,
  ExpenseClaim,
  Proposal,
  Client,
  Lead,
} from "@/types";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await getTrashService().removeFromTrash(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const trashed = await getTrashService().removeFromTrash(params.id);
    if (!trashed) {
      return NextResponse.json({ error: "Item not found in trash" }, { status: 404 });
    }

    switch (trashed.entityType) {
      case "invoice": {
        const sub = trashed.data as InvoiceSubmission;
        const month = sub.closingMonth ?? "unknown";
        await getStorageService().saveSubmissions([sub], month);
        break;
      }
      case "expense": {
        await getExpenseService().saveClaim(trashed.data as ExpenseClaim);
        break;
      }
      case "proposal": {
        await getProposalService().saveProposal(trashed.data as Proposal);
        break;
      }
      case "client": {
        await getClientService().saveClient(trashed.data as Client);
        break;
      }
      case "lead": {
        await getLeadService().saveLead(trashed.data as Lead);
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown entity type" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, entityType: trashed.entityType });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
