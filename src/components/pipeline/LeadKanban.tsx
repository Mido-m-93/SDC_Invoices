"use client";

import type { Lead, LeadStage } from "@/types";

const STAGE_CONFIG: Record<LeadStage, { label: string; border: string; header: string }> = {
  new:           { label: "New",           border: "border-stone-200",   header: "bg-stone-50 text-stone-600"     },
  contacted:     { label: "Contacted",     border: "border-blue-200",    header: "bg-blue-50 text-blue-700"       },
  qualified:     { label: "Qualified",     border: "border-indigo-200",  header: "bg-indigo-50 text-indigo-700"   },
  proposal_sent: { label: "Proposal Sent", border: "border-violet-200",  header: "bg-violet-50 text-violet-700"   },
  negotiation:   { label: "Negotiation",   border: "border-amber-200",   header: "bg-amber-50 text-amber-700"     },
  won:           { label: "Won",           border: "border-emerald-200", header: "bg-emerald-50 text-emerald-700" },
  lost:          { label: "Lost",          border: "border-red-200",     header: "bg-red-50 text-red-600"         },
  on_hold:       { label: "On Hold",       border: "border-orange-200",  header: "bg-orange-50 text-orange-700"   },
};

const STAGE_ORDER: LeadStage[] = [
  "new", "contacted", "qualified", "proposal_sent", "negotiation", "won", "lost", "on_hold",
];

const NEXT_STAGE: Partial<Record<LeadStage, LeadStage>> = {
  new: "contacted",
  contacted: "qualified",
  qualified: "proposal_sent",
  proposal_sent: "negotiation",
  negotiation: "won",
};

interface Props {
  leads: Lead[];
  onEdit: (lead: Lead) => void;
  onStageChange: (id: string, stage: LeadStage) => void;
}

export default function LeadKanban({ leads, onEdit, onStageChange }: Props) {
  return (
    <div className="overflow-x-auto pb-4 -mx-1 px-1">
      <div className="flex gap-3 min-w-max">
        {STAGE_ORDER.map((stage) => {
          const stageLeads = leads.filter((l) => l.stage === stage);
          const totalValue = stageLeads.reduce((s, l) => s + l.estimatedValue, 0);
          const cfg = STAGE_CONFIG[stage];
          const nextStage = NEXT_STAGE[stage];

          return (
            <div key={stage} className={`w-64 flex-shrink-0 rounded-xl border-2 overflow-hidden ${cfg.border}`}>
              <div className={`px-3 py-2.5 ${cfg.header}`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-semibold uppercase tracking-wide">{cfg.label}</span>
                  <span className="text-xs font-medium bg-white/60 rounded-full px-1.5 py-0.5">
                    {stageLeads.length}
                  </span>
                </div>
                {totalValue > 0 && (
                  <div className="text-xs opacity-60">
                    ¥{totalValue.toLocaleString("ja-JP")}
                  </div>
                )}
              </div>

              <div className="p-2 space-y-2 bg-white min-h-20">
                {stageLeads.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => onEdit(lead)}
                    className="group bg-white border border-stone-200 rounded-lg p-3 cursor-pointer hover:border-stone-300 hover:shadow-sm transition-all"
                  >
                    <div className="text-sm font-medium text-stone-800 line-clamp-2 mb-1">
                      {lead.title}
                    </div>
                    {(lead.clientName || lead.clientId) && (
                      <div className="text-xs text-stone-500 mb-2 truncate">
                        {lead.clientName || lead.clientId}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs">
                      {lead.estimatedValue > 0 ? (
                        <span className="font-semibold text-stone-700">
                          ¥{lead.estimatedValue.toLocaleString("ja-JP")}
                        </span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                      {lead.probability > 0 && (
                        <span className="text-stone-400">{lead.probability}%</span>
                      )}
                    </div>
                    {lead.assignedTo && (
                      <div className="text-xs text-stone-400 mt-1.5 truncate">{lead.assignedTo}</div>
                    )}
                    {nextStage && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onStageChange(lead.id, nextStage); }}
                        className="mt-2 w-full text-xs py-1 rounded border border-stone-200 text-stone-400 hover:bg-stone-50 hover:text-stone-600 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        → {STAGE_CONFIG[nextStage].label}
                      </button>
                    )}
                  </div>
                ))}
                {stageLeads.length === 0 && (
                  <div className="text-xs text-stone-300 text-center py-4">Empty</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
