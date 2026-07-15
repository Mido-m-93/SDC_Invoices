// ─────────────────────────────────────────────────────────────────────────────
// lib/services/mock/pipelineSources.ts — mock Notion + SharePoint pipeline data
//
// Stand-ins for the real integrations (no Notion API / SharePoint pipeline
// list is wired up yet). Deliberately messy — aliased/misspelled client names,
// one brand-new client, one exact match — so the extraction + matching logic
// gets a realistic workout before real credentials are connected.
// ─────────────────────────────────────────────────────────────────────────────

import type { ExtractedPipelineItem } from "@/lib/services/ai/pipelineExtraction";

// A normal (non-database) Notion page: headings + bullets, inconsistent formatting.
export function getMockNotionRawText(): string {
  return `# Sales Pipeline — Working Notes

## Osaka Tech
- Deal: Cloud migration Phase 3 follow-on
- Status: in talks, expecting to send proposal next week
- Ballpark: ¥2,000,000
- Contact: Hanako Nakamura (nakamura@otp.co.jp)
- Notes: they liked Phase 2 delivery, low risk renewal

## SDC 株式会社
- Project: Q3 support retainer renewal
- Status: won — contract signing this month
- Amount: 3,000,000 JPY
- Contact: Taro Yamada

## Brand New Robotics Co
- New inbound lead from webform
- Status: new, not yet contacted
- Project: warehouse automation assessment
- Estimated value: ¥1,200,000
- Contact: info@brandnewrobotics.jp

## Kyoto Robotics
- Following up on the AI pilot proposal sent last month
- Status: proposal sent, awaiting decision
- Value: about 1.8M yen
- Contact: Makoto Tanaka
`;
}

// A SharePoint-tracked pipeline list — already tabular, so no extraction pass
// is needed; these map ~directly onto ExtractedPipelineItem.
export function getMockSharePointPipelineRecords(): ExtractedPipelineItem[] {
  return [
    {
      rawClientName: "Fukuoka Digital",
      projectName: "Mobile app phase 2",
      stageOrStatus: "negotiation",
      estimatedAmount: 2500000,
      currency: "JPY",
      contactName: "Sachiko Sato",
      contactEmail: "sato@fukuoka-digital.jp",
      notes: "Tracked in SharePoint pipeline list — exact name match expected.",
    },
    {
      rawClientName: "RoboCo op Singapore Pte",
      projectName: "Phase 2 infrastructure support",
      stageOrStatus: "qualified",
      estimatedAmount: 1500000,
      currency: "JPY",
      contactName: "Mei Ling Lee",
      contactEmail: "meilin@roboco-op.sg",
      notes: "Name slightly different from client master — should still fuzzy-match.",
    },
    {
      rawClientName: "Nagano Precision Works",
      projectName: "Factory sensor rollout",
      stageOrStatus: "new",
      estimatedAmount: 4200000,
      currency: "JPY",
      contactName: null,
      contactEmail: null,
      notes: "No existing client record — should route to needs_review as a new client.",
    },
  ];
}
