// src/app/mock/mf-billing/[id]/page.tsx
//
// Landing page for the fake billingUrl returned by MockMoneyForwardService.
// Exists so the 💴 "View in MF" link resolves to something real instead of
// 404ing on invoice.moneyforward.com — no real Money Forward account is
// contacted by the mock service.

export default function MockBillingPage({ params }: { params: { id: string } }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-lg font-semibold text-stone-900 mb-2">💴 Mock Money Forward Billing</h1>
      <p className="text-sm text-stone-500 mb-6">
        This is a simulated billing page from MockMoneyForwardService — no real Money Forward
        account was contacted.
      </p>
      <div className="rounded-lg bg-stone-100 px-4 py-3 font-mono text-sm text-stone-700">
        Billing ID: {params.id}
      </div>
    </div>
  );
}
