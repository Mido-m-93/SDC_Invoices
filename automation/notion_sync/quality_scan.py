"""🧪 Test_Unified_Pipeline v2 のデータ品質スキャン。

READ-ONLY。v2 DB の全ページを取得し、以下の品質問題を検出してレポート出力する。

検出項目:
    1. Company 空欄（営業が手動補完すべき）
    2. Status == "Lead" かつ source=global_pipeline（手動確認候補）
    3. Revenue_千円 空 かつ Status >= Contracted（請求漏れリスク）
    4. Source_DB 分布（jp/global/old_unified 比率）
    5. Status 分布
    6. Sales_In_Charge 空欄（担当者未設定）

使い方:
    python quality_scan.py
"""

from __future__ import annotations

import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from fuzzy_dup_review import (
    V2_DATA_SOURCE_ID,
    extract_plain_text,
)
from notion_client import NotionClient, NotionConfig

HERE = Path(__file__).parent
LOG_DIR = HERE / "logs"

# Contracted 以降の Status（Revenue が入っているべき）
CONTRACTED_AND_ABOVE = {
    "Contracted", "Delivery", "Delivered",
    "Negotiation", "Proposal", "Closing",
}


def md_escape(s: str) -> str:
    return (s or "—").replace("|", "\\|").replace("\n", " ")


def render_report(rows: list[dict]) -> str:
    now = datetime.now(timezone.utc).isoformat()
    lines: list[str] = []
    lines.append("# Notion v2 データ品質レポート")
    lines.append("")
    lines.append(f"- 生成日時: {now}")
    lines.append(f"- 総ページ数: {len(rows)}")
    lines.append("")

    # --- 1. Company 空欄 ---
    empty_company = [r for r in rows if not r["company"]]
    lines.append(f"## 1. Company 空欄 ({len(empty_company)}件)")
    lines.append("")
    if empty_company:
        lines.append("| Project | Status | Source_DB | Owner | URL |")
        lines.append("|---|---|---|---|---|")
        for r in sorted(empty_company, key=lambda x: x["status"]):
            lines.append(
                f"| {md_escape(r['project'])} | {md_escape(r['status'])} | "
                f"{md_escape(r['source_db'])} | {md_escape(r['owner'])} | "
                f"[open]({r['url']}) |"
            )
    else:
        lines.append("_なし_")
    lines.append("")

    # --- 2. Lead × global_pipeline ---
    lead_global = [
        r for r in rows
        if r["status"] == "Lead" and r["source_db"] == "global_pipeline"
    ]
    lines.append(f"## 2. Lead × global_pipeline（要手動確認） ({len(lead_global)}件)")
    lines.append("")
    if lead_global:
        lines.append("| Company | Project | Owner | URL |")
        lines.append("|---|---|---|---|")
        for r in lead_global:
            lines.append(
                f"| {md_escape(r['company'])} | {md_escape(r['project'])} | "
                f"{md_escape(r['owner'])} | [open]({r['url']}) |"
            )
    else:
        lines.append("_なし_")
    lines.append("")

    # --- 3. Revenue 空 × Status >= Contracted ---
    revenue_missing = [
        r for r in rows
        if r["status"] in CONTRACTED_AND_ABOVE and not r.get("revenue")
    ]
    lines.append(f"## 3. Revenue 空 × Contracted 以降（請求漏れリスク） ({len(revenue_missing)}件)")
    lines.append("")
    if revenue_missing:
        lines.append("| Company | Project | Status | Source_DB | URL |")
        lines.append("|---|---|---|---|---|")
        for r in sorted(revenue_missing, key=lambda x: x["status"]):
            lines.append(
                f"| {md_escape(r['company'])} | {md_escape(r['project'])} | "
                f"{md_escape(r['status'])} | {md_escape(r['source_db'])} | "
                f"[open]({r['url']}) |"
            )
    else:
        lines.append("_なし_")
    lines.append("")

    # --- 4. Source_DB 分布 ---
    source_dist = Counter(r["source_db"] or "(空)" for r in rows)
    lines.append("## 4. Source_DB 分布")
    lines.append("")
    lines.append("| Source_DB | 件数 | 比率 |")
    lines.append("|---|---|---|")
    for src, cnt in source_dist.most_common():
        lines.append(f"| {src} | {cnt} | {cnt/len(rows)*100:.1f}% |")
    lines.append("")

    # --- 5. Status 分布 ---
    status_dist = Counter(r["status"] or "(空)" for r in rows)
    lines.append("## 5. Status 分布")
    lines.append("")
    lines.append("| Status | 件数 | 比率 |")
    lines.append("|---|---|---|")
    for st, cnt in status_dist.most_common():
        lines.append(f"| {st} | {cnt} | {cnt/len(rows)*100:.1f}% |")
    lines.append("")

    # --- 6. Sales_In_Charge 空欄 ---
    no_owner = [r for r in rows if not r["owner"]]
    lines.append(f"## 6. 担当者未設定 ({len(no_owner)}件)")
    lines.append("")
    if no_owner:
        lines.append("| Company | Project | Status | Source_DB | URL |")
        lines.append("|---|---|---|---|---|")
        for r in sorted(no_owner, key=lambda x: (x["status"], x["company"])):
            lines.append(
                f"| {md_escape(r['company'])} | {md_escape(r['project'])} | "
                f"{md_escape(r['status'])} | {md_escape(r['source_db'])} | "
                f"[open]({r['url']}) |"
            )
    else:
        lines.append("_なし_")
    lines.append("")

    # --- サマリー ---
    lines.append("## サマリー")
    lines.append("")
    lines.append(f"- Company 空欄: **{len(empty_company)}件** → 営業が補完")
    lines.append(f"- Lead × global: **{len(lead_global)}件** → 手動確認/アーカイブ判断")
    lines.append(f"- Revenue 空 × Contracted+: **{len(revenue_missing)}件** → 請求漏れチェック")
    lines.append(f"- 担当者未設定: **{len(no_owner)}件** → 割り当て")
    lines.append("")

    return "\n".join(lines)


def fetch_pages_with_revenue(client: NotionClient) -> list[dict]:
    """fetch_pages と同じだが Revenue_千円 も含む1パス取得。"""
    rows: list[dict] = []
    for i, page in enumerate(client.query_data_source(V2_DATA_SOURCE_ID), start=1):
        props = page.get("properties", {})
        company = extract_plain_text(props.get("Company")).strip()
        project = extract_plain_text(props.get("Project Name")).strip()
        revenue = extract_plain_text(props.get("Revenue_千円")).strip()
        rows.append({
            "id": page["id"],
            "url": page.get("url", ""),
            "company": company,
            "project": project,
            "status": extract_plain_text(props.get("Status")),
            "source_db": extract_plain_text(props.get("Source_DB")),
            "owner": extract_plain_text(props.get("Sales_In_Charge")),
            "last_edited": page.get("last_edited_time", ""),
            "revenue": revenue,
        })
        if i % 100 == 0:
            print(f"  fetched {i} ...", flush=True)
    return rows


def main() -> int:
    load_dotenv(HERE / ".env")
    client = NotionClient(NotionConfig.from_env())

    print(f"Querying data_source {V2_DATA_SOURCE_ID} ...", flush=True)
    rows = fetch_pages_with_revenue(client)
    print(f"Fetched {len(rows)} pages.", flush=True)

    report = render_report(rows)
    today = datetime.now().strftime("%Y%m%d")
    report_path = LOG_DIR / f"quality_report_{today}.md"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report, encoding="utf-8")
    print(f"Report written: {report_path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
