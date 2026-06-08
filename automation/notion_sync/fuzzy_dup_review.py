"""🧪 Test_Unified_Pipeline v2 の fuzzy 重複レビュースクリプト。

READ-ONLY. Never writes to v2 DB.
v2 DB の全ページを取得し、Company + Project Name の token_set_ratio で
クラスタリングして手動マージ判断用の Markdown レポートを出力する。

使い方:
    python fuzzy_dup_review.py
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from rapidfuzz import fuzz

from notion_client import NotionClient, NotionConfig

HERE = Path(__file__).parent
LOG_DIR = HERE / "logs"
REPORT_PATH = LOG_DIR / "fuzzy_dup_report.md"

V2_DATA_SOURCE_ID = "dbeaedd1-6635-4607-92b1-1ca54c9df7e6"

# Company と Project を独立スコアして AND 条件で判定する
# （v2 では Company が空のレコードが多いため "Company + Project" 連結だと
#   "AI Automation" 等の一般語で巨大クラスタが生まれてしまう）
HIGH_COMPANY = 85
HIGH_PROJECT = 75
LOW_COMPANY = 75
LOW_PROJECT = 70
# Company 両方空のペアは Project 完全一致に近い時のみ要確認に拾う
EMPTY_COMPANY_PROJECT_THRESHOLD = 90
EMPTY_COMPANY_MIN_PROJECT_LEN = 10

logger = logging.getLogger("fuzzy_dup_review")


# ----------------------------------------------------------------------
# Notion property helpers (merge_pipeline.py から最小限のみ抜粋)
# ----------------------------------------------------------------------
def extract_plain_text(prop: dict | None) -> str:
    if not prop:
        return ""
    t = prop.get("type")
    if t == "title":
        return "".join(b.get("plain_text", "") for b in prop.get("title", []))
    if t == "rich_text":
        return "".join(b.get("plain_text", "") for b in prop.get("rich_text", []))
    if t == "select":
        sel = prop.get("select")
        return sel.get("name", "") if sel else ""
    if t == "status":
        sel = prop.get("status")
        return sel.get("name", "") if sel else ""
    if t == "people":
        return ", ".join(p.get("name", "") or p.get("id", "") for p in prop.get("people", []))
    if t == "url":
        return prop.get("url") or ""
    return ""


# ----------------------------------------------------------------------
# Union-Find
# ----------------------------------------------------------------------
class UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------
def fetch_pages(client: NotionClient) -> list[dict]:
    rows: list[dict] = []
    for i, page in enumerate(client.query_data_source(V2_DATA_SOURCE_ID), start=1):
        props = page.get("properties", {})
        company = extract_plain_text(props.get("Company")).strip()
        project = extract_plain_text(props.get("Project Name")).strip()
        rows.append({
            "id": page["id"],
            "url": page.get("url", ""),
            "company": company,
            "project": project,
            "status": extract_plain_text(props.get("Status")),
            "source_db": extract_plain_text(props.get("Source_DB")),
            "owner": extract_plain_text(props.get("Sales_In_Charge")),
            "last_edited": page.get("last_edited_time", ""),
        })
        if i % 100 == 0:
            print(f"  fetched {i} ...", flush=True)
    return rows


def cluster_pairs(rows: list[dict]) -> tuple[list[list[int]], list[tuple[int, int, int, int]]]:
    """Company と Project を独立スコアして HIGH=クラスタ / LOW=ペアに分ける。

    review_pairs entry: (company_score, project_score, i, j)
        company_score == -1 は「片方/両方の Company が空」の sentinel。
    """
    n = len(rows)
    uf = UnionFind(n)
    review_pairs: list[tuple[int, int, int, int]] = []

    print(f"  scoring {n*(n-1)//2} pairs...", flush=True)

    for i in range(n):
        ri = rows[i]
        ci, pi = ri["company"], ri["project"]
        if not pi:
            continue
        for j in range(i + 1, n):
            rj = rows[j]
            cj, pj = rj["company"], rj["project"]
            if not pj:
                continue

            both_have_company = bool(ci) and bool(cj)
            project_score = fuzz.token_set_ratio(pi, pj)

            if both_have_company:
                company_score = fuzz.token_set_ratio(ci, cj)
                if company_score >= HIGH_COMPANY and project_score >= HIGH_PROJECT:
                    uf.union(i, j)
                elif company_score >= LOW_COMPANY and project_score >= LOW_PROJECT:
                    review_pairs.append((company_score, project_score, i, j))
            # 両方/片方 Company 空の場合はペア化しない（後段の "empty-company groups" で
            # プロジェクト名で集約して提示する。ノイズが多すぎるためペア列挙はしない）

    clusters_map: dict[int, list[int]] = {}
    for idx in range(n):
        root = uf.find(idx)
        clusters_map.setdefault(root, []).append(idx)
    clusters = [members for members in clusters_map.values() if len(members) >= 2]
    return clusters, review_pairs


def cluster_max_score(members: list[int], rows: list[dict]) -> int:
    best = 0
    for ii in range(len(members)):
        for jj in range(ii + 1, len(members)):
            ra, rb = rows[members[ii]], rows[members[jj]]
            if ra["company"] and rb["company"]:
                s = min(
                    fuzz.token_set_ratio(ra["company"], rb["company"]),
                    fuzz.token_set_ratio(ra["project"], rb["project"]),
                )
            else:
                s = fuzz.token_set_ratio(ra["project"], rb["project"])
            if s > best:
                best = s
    return best


def md_escape(s: str) -> str:
    return (s or "").replace("|", "\\|").replace("\n", " ")


def empty_company_groups(rows: list[dict]) -> list[tuple[str, list[int]]]:
    """Company 空 × 同一 Project 名のレコードを束ねる。
    Project が短すぎる/汎用すぎるとノイズだが、判断は人間が行うので 2件以上で出す。
    """
    buckets: dict[str, list[int]] = {}
    for idx, r in enumerate(rows):
        if r["company"]:
            continue
        if not r["project"]:
            continue
        key = r["project"].strip().lower()
        buckets.setdefault(key, []).append(idx)
    groups = [(rows[mems[0]]["project"], mems) for key, mems in buckets.items() if len(mems) >= 2]
    groups.sort(key=lambda g: -len(g[1]))
    return groups


def render_report(
    rows: list[dict],
    clusters: list[list[int]],
    review_pairs: list[tuple[int, int, int, int]],
    empty_groups: list[tuple[str, list[int]]],
) -> str:
    clusters_with_score = sorted(
        ((cluster_max_score(m, rows), m) for m in clusters),
        key=lambda x: x[0],
        reverse=True,
    )

    lines: list[str] = []
    lines.append("# Fuzzy Duplicate Review — Test_Unified_Pipeline v2")
    lines.append("")
    lines.append(f"- Generated: {datetime.now(timezone.utc).isoformat()}")
    lines.append(f"- Total pages scanned: {len(rows)}")
    lines.append(f"- High-confidence clusters (Company≥{HIGH_COMPANY} & Project≥{HIGH_PROJECT}): {len(clusters_with_score)}")
    lines.append(f"- Loose review pairs (both have Company, weaker match): {len(review_pairs)}")
    lines.append(f"- Empty-company groups (same Project, Company missing): {len(empty_groups)}")
    lines.append("")
    lines.append("> 読み取り専用レポート。統合判断は Notion 上で手動で実施。")
    lines.append("")

    lines.append("## High-confidence clusters")
    lines.append("")
    if not clusters_with_score:
        lines.append("_None._")
        lines.append("")
    for cidx, (max_score, members) in enumerate(clusters_with_score, start=1):
        lines.append(f"### Cluster #{cidx} (size: {len(members)}, max score: {max_score:.0f})")
        lines.append("")
        lines.append("| Company | Project | Status | Source_DB | Owner | Last edited | URL |")
        lines.append("|---|---|---|---|---|---|---|")
        for idx in members:
            r = rows[idx]
            lines.append(
                f"| {md_escape(r['company'])} | {md_escape(r['project'])} | "
                f"{md_escape(r['status'])} | {md_escape(r['source_db'])} | "
                f"{md_escape(r['owner'])} | {r['last_edited'][:10]} | "
                f"[open]({r['url']}) |"
            )
        lines.append("")

    lines.append("## Loose review pairs (Company の表記ゆれ候補)")
    lines.append("")
    lines.append(
        f"Company {LOW_COMPANY}-{HIGH_COMPANY - 1} & Project ≥ {LOW_PROJECT}. 別法人だが類似名の可能性あり、要確認。"
    )
    lines.append("")
    if not review_pairs:
        lines.append("_None._")
        lines.append("")
    else:
        lines.append("| C-score | P-score | Page A (Company / Project) | Page B (Company / Project) |")
        lines.append("|---|---|---|---|")
        review_pairs_sorted = sorted(review_pairs, key=lambda x: (x[0], x[1]), reverse=True)
        for cscore, pscore, i, j in review_pairs_sorted:
            ra, rb = rows[i], rows[j]
            a = f"{md_escape(ra['company'])} / {md_escape(ra['project'])} ([open]({ra['url']}))"
            b = f"{md_escape(rb['company'])} / {md_escape(rb['project'])} ([open]({rb['url']}))"
            lines.append(f"| {cscore} | {pscore} | {a} | {b} |")
        lines.append("")

    lines.append("## Empty-company groups（Company を埋めれば dedup できる候補）")
    lines.append("")
    lines.append(
        "Company が空のレコードを Project 名で集約。Notion 上で Company を埋めてから merge_pipeline を再実行すれば自動 dedup される可能性が高い。"
    )
    lines.append("")
    if not empty_groups:
        lines.append("_None._")
        lines.append("")
    for gidx, (project_name, members) in enumerate(empty_groups, start=1):
        lines.append(f"### Group #{gidx}: Project = `{project_name}` (size: {len(members)})")
        lines.append("")
        lines.append("| Status | Source_DB | Last edited | URL |")
        lines.append("|---|---|---|---|")
        for idx in members:
            r = rows[idx]
            lines.append(
                f"| {md_escape(r['status'])} | {md_escape(r['source_db'])} | "
                f"{r['last_edited'][:10]} | [open]({r['url']}) |"
            )
        lines.append("")

    return "\n".join(lines)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_dotenv(HERE / ".env")

    config = NotionConfig.from_env()
    client = NotionClient(config)

    print(f"Querying data_source {V2_DATA_SOURCE_ID} ...", flush=True)
    rows = fetch_pages(client)
    print(f"Fetched {len(rows)} pages.", flush=True)

    print("Clustering...", flush=True)
    clusters, review_pairs = cluster_pairs(rows)
    empty_groups = empty_company_groups(rows)
    print(
        f"Clusters: {len(clusters)}, review pairs: {len(review_pairs)}, "
        f"empty-company groups: {len(empty_groups)}",
        flush=True,
    )

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    report = render_report(rows, clusters, review_pairs, empty_groups)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"Report written: {REPORT_PATH}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
