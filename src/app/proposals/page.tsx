"use client";

import { useState } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/ui/PageHeader";
import PipelineSyncContent from "@/components/pipeline-sync/PipelineSyncContent";
import ProposalsContent from "@/components/proposals/ProposalsContent";
import { useLanguage } from "@/translations";

type Tab = "pipeline" | "proposals";

export default function PipelineAndProposalPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>("proposals");

  return (
    <AppShell>
      <PageHeader title={t("nav_proposals")} subtitle={t("pipeline_and_proposal_subtitle")} />

      <div className="mb-5 flex gap-1 border-b border-stone-200">
        {(["proposals", "pipeline"] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === tb
                ? "border-[#1a3d2b] text-[#1a3d2b]"
                : "border-transparent text-stone-400 hover:text-stone-600"
            }`}
          >
            {tb === "proposals" ? t("tab_proposals") : t("tab_pipeline")}
          </button>
        ))}
      </div>

      {tab === "proposals" ? <ProposalsContent compact /> : <PipelineSyncContent compact />}
    </AppShell>
  );
}
