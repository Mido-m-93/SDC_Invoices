"use client";

import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import { useLanguage } from "@/translations";

// Placeholder — the Budget data model, SharePoint sync, and cross-document
// verification are still being designed. See the Sales nav restructure that
// introduced this route.
export default function BudgetPage() {
  const { t } = useLanguage();
  return (
    <AppShell>
      <PageHeader title={t("budget_title")} subtitle={t("budget_subtitle")} />
      <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
        <p className="text-stone-400 text-sm">{t("budget_placeholder_text")}</p>
      </div>
    </AppShell>
  );
}
