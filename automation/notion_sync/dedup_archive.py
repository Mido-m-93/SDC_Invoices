"""v2「🧪 Test_Unified_Pipeline v2」の重複を自動 archive する。

前提:
    Unified v1 (= old_unified) が独立してバックアップとして存在する。
    v2 は merge 後の作業用 DB なので、ここでの archive は v1 を破壊しない。

ルール:
    HIGH-confidence cluster (Company≥85 & Project≥75) と
    empty-company group (Company 空 + 同一 Project) を対象に survivor を1件残し、
    他を archive (= Notion ゴミ箱、30日以内なら復元可)。

Survivor 選択:
    1. Source_DB 優先: old_unified > jp_pipeline > global_pipeline > その他
    2. Status 進度: Delivered > Delivery > Contracted > Negotiation > Proposal >
       Closing > Discovery > Pending > Lead > Lost > その他
    3. last_edited_time DESC（新しい方）
    4. page_id 昇順（決定論的タイブレーク）

使い方:
    python dedup_archive.py            # dry-run（archive せず計画のみ表示）
    python dedup_archive.py --apply    # 実際に archive
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

from fuzzy_dup_review import (
    V2_DATA_SOURCE_ID,
    cluster_pairs,
    empty_company_groups,
    fetch_pages,
)
from notion_client import NotionClient, NotionConfig

HERE = Path(__file__).parent
LOG_DIR = HERE / "logs"

SOURCE_DB_PRIORITY = {
    "old_unified": 0,
    "jp_pipeline": 1,
    "global_pipeline": 2,
}

STATUS_PRIORITY = {
    "Delivered": 0,
    "Delivery": 1,
    "Contracted": 2,
    "Negotiation": 3,
    "Proposal": 4,
    "Closing": 5,
    "Discovery": 6,
    "Pending": 7,
    "Lead": 8,
    "Lost": 9,
}


def survivor_key(row: dict) -> tuple:
    return (
        SOURCE_DB_PRIORITY.get(row["source_db"], 99),
        STATUS_PRIORITY.get(row["status"], 99),
        # last_edited DESC: negate by reversing string compare via tuple inversion
        # 文字列ISO8601は降順=辞書順逆。タプルで -1*ord は使えないので別のキーで反転
        tuple(-ord(c) for c in row["last_edited"]),
        row["id"],
    )


def pick_survivor(members: list[int], rows: list[dict]) -> int:
    return min(members, key=lambda idx: survivor_key(rows[idx]))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="実際に archive する")
    args = parser.parse_args()

    load_dotenv(HERE / ".env")
    client = NotionClient(NotionConfig.from_env())

    print(f"Querying data_source {V2_DATA_SOURCE_ID} ...", flush=True)
    rows = fetch_pages(client)
    print(f"Fetched {len(rows)} pages.", flush=True)

    print("Clustering...", flush=True)
    clusters, _ = cluster_pairs(rows)
    empty_groups = empty_company_groups(rows)
    print(f"HIGH clusters: {len(clusters)}, empty-company groups: {len(empty_groups)}")

    plan: list[tuple[str, dict, dict]] = []  # (group_label, survivor_row, victim_row)

    for cidx, members in enumerate(clusters, start=1):
        survivor = pick_survivor(members, rows)
        for idx in members:
            if idx == survivor:
                continue
            plan.append((f"HIGH#{cidx}", rows[survivor], rows[idx]))

    for gidx, (project_name, members) in enumerate(empty_groups, start=1):
        survivor = pick_survivor(members, rows)
        for idx in members:
            if idx == survivor:
                continue
            plan.append((f"EMPTY#{gidx}({project_name})", rows[survivor], rows[idx]))

    print(f"\nArchive plan: {len(plan)} pages will be archived.\n")
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    plan_path = LOG_DIR / "dedup_archive_plan.md"
    with plan_path.open("w", encoding="utf-8") as f:
        f.write(f"# Dedup archive plan\n\n- Total to archive: {len(plan)}\n\n")
        f.write("| Group | Keep (Company / Project / Status / Source_DB) | Archive (Company / Project / Status / Source_DB) | Archive URL |\n")
        f.write("|---|---|---|---|\n")
        for label, surv, vic in plan:
            keep = f"{surv['company']} / {surv['project']} / {surv['status']} / {surv['source_db']}"
            arc = f"{vic['company']} / {vic['project']} / {vic['status']} / {vic['source_db']}"
            f.write(f"| {label} | {keep} | {arc} | [open]({vic['url']}) |\n")
    print(f"Plan written: {plan_path}")

    if not args.apply:
        print("\nDRY-RUN. Re-run with --apply to actually archive.")
        return 0

    print("\nAPPLYING archive ...")
    archived = 0
    failed = 0
    for label, _surv, vic in plan:
        try:
            client.archive_page(vic["id"])
            archived += 1
            if archived % 20 == 0:
                print(f"  archived {archived}/{len(plan)} ...", flush=True)
            time.sleep(0.35)  # Notion レート制限 3req/s 対応
        except Exception as e:
            failed += 1
            print(f"  FAIL {label} {vic['id']}: {e}")
    print(f"\nDone. archived={archived} failed={failed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
