"""🧪 Test_Unified_Pipeline v2 DB を Notion 上に新規作成するスクリプト。

使い方:
    python create_unified_v2.py --dry-run   # 計画のみ表示（デフォルト）
    python create_unified_v2.py --apply     # 実際にNotion上に作成

前提:
    .env に NOTION_TOKEN と NEW_UNIFIED_V2_PARENT_PAGE_ID を記入
    （parent_page_id = 新DBを置きたいNotionページのID。Integrationに編集権限を付与しておく）
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import yaml
from dotenv import load_dotenv

from notion_client import NotionClient, NotionConfig

HERE = Path(__file__).parent
CONFIG_PATH = HERE / "config.yaml"
LOG_DIR = HERE / "logs"

logger = logging.getLogger("create_unified_v2")

# 🗂 RC Unified Pipeline のスキーマを踏襲しつつ、出身DB追跡用の列を追加
UNIFIED_V2_PROPERTIES: dict[str, dict] = {
    "Project Name":    {"title": {}},
    "Company":         {"rich_text": {}},  # 初期はtextで受ける（後でrelation化も可能）
    "Status": {
        "select": {
            "options": [
                {"name": "Lead",        "color": "gray"},
                {"name": "Pending",     "color": "default"},
                {"name": "Discovery",   "color": "blue"},
                {"name": "Proposal",    "color": "purple"},
                {"name": "Negotiation", "color": "orange"},
                {"name": "Closing",     "color": "yellow"},
                {"name": "Contracted",  "color": "green"},
                {"name": "Delivery",    "color": "pink"},
                {"name": "Delivered",   "color": "brown"},
                {"name": "Lost",        "color": "red"},
            ]
        }
    },
    "Contract_Status": {"rich_text": {}},
    "Contract_Start":  {"date": {}},
    "Contract_End":    {"date": {}},
    "Expected_Close":  {"date": {}},
    "Last_Discussion": {"date": {}},
    "Revenue_千円":     {"number": {"format": "number_with_commas"}},
    "Revenue_月_千円":   {"number": {"format": "number_with_commas"}},
    "PJ_Term_months":  {"number": {"format": "number"}},
    "PJ_Number":       {"rich_text": {}},
    "Industry":        {"rich_text": {}},
    "Probability":     {"select": {"options": [
        {"name": "Low", "color": "gray"}, {"name": "Middle", "color": "yellow"}, {"name": "High", "color": "green"},
    ]}},
    "Strategic_Fit":   {"rich_text": {}},
    "Priority":        {"select": {"options": [
        {"name": "Low", "color": "gray"}, {"name": "Middle", "color": "yellow"}, {"name": "High", "color": "red"},
    ]}},
    "Region":          {"select": {"options": [
        {"name": "JP", "color": "red"}, {"name": "US", "color": "blue"},
        {"name": "SG", "color": "green"}, {"name": "Other", "color": "gray"},
    ]}},
    "Project_Type":    {"rich_text": {}},
    "Sales_In_Charge": {"rich_text": {}},
    "Next_Step":       {"rich_text": {}},
    "New_Continuing":  {"select": {"options": [
        {"name": "New", "color": "blue"}, {"name": "Continuing", "color": "green"},
    ]}},
    "Cash_In_Start":   {"date": {}},
    "Cash_In_End":     {"date": {}},
    "Invoice_Dates":   {"rich_text": {}},
    "Payment_Dates":   {"rich_text": {}},
    "Payment_Terms":   {"rich_text": {}},
    "Notes":           {"rich_text": {}},
    # 統合トラッキング用（新規列）
    "Source_DB":       {"select": {"options": [
        {"name": "old_unified",     "color": "green"},
        {"name": "jp_pipeline",     "color": "blue"},
        {"name": "global_pipeline", "color": "orange"},
        {"name": "manual",          "color": "gray"},
    ]}},
    "Original_URL":    {"url": {}},
    "Merged_At":       {"date": {}},
    "Merge_Status":    {"select": {"options": [
        {"name": "synced",        "color": "green"},
        {"name": "needs_review",  "color": "yellow"},
        {"name": "duplicate_of",  "color": "orange"},
        {"name": "manual_edit",   "color": "purple"},
    ]}},
}


def setup_logging(log_file: Path) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.FileHandler(log_file, encoding="utf-8"), logging.StreamHandler(sys.stdout)],
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="新Unified v2 DBをNotion上に作成")
    parser.add_argument("--apply", action="store_true", help="実際に作成（指定なしはdry-run）")
    parser.add_argument("--parent-page-id", default=None, help=".envの値を上書き")
    args = parser.parse_args()

    load_dotenv(HERE / ".env")
    from datetime import datetime
    setup_logging(LOG_DIR / f"create_unified_v2_{datetime.now():%Y-%m-%d}.log")

    with CONFIG_PATH.open(encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    parent_id = args.parent_page_id or os.environ.get("NEW_UNIFIED_V2_PARENT_PAGE_ID")
    if not parent_id:
        logger.error("NEW_UNIFIED_V2_PARENT_PAGE_ID が未設定。--parent-page-id か .env で指定してください")
        return 2

    title = cfg["databases"]["new_unified_v2"]["title"]

    logger.info("=" * 60)
    logger.info("新Unified v2 DB作成計画")
    logger.info("  タイトル: %s", title)
    logger.info("  親ページID: %s", parent_id)
    logger.info("  プロパティ数: %d", len(UNIFIED_V2_PROPERTIES))
    for name in UNIFIED_V2_PROPERTIES:
        logger.info("    - %s", name)
    logger.info("=" * 60)

    if not args.apply:
        logger.info("[DRY-RUN] --apply が指定されていないため、実際の作成はスキップ")
        return 0

    client = NotionClient(NotionConfig.from_env())
    result = client.create_database(parent_id, title, UNIFIED_V2_PROPERTIES)

    db_id = result["id"]
    data_sources = result.get("data_sources", [])
    ds_id = data_sources[0]["id"] if data_sources else None

    logger.info("✅ DB作成完了")
    logger.info("  database_id: %s", db_id)
    logger.info("  data_source_id: %s", ds_id)

    # config.yaml に書き戻す（安全のため .new.yaml に書いてユーザー確認）
    cfg["databases"]["new_unified_v2"]["database_id"] = db_id
    cfg["databases"]["new_unified_v2"]["data_source_id"] = ds_id
    cfg["databases"]["new_unified_v2"]["parent_page_id"] = parent_id
    out = CONFIG_PATH.with_suffix(".yaml.new")
    with out.open("w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)
    logger.info("📝 %s に更新後の config を書き出しました。内容確認の上、config.yaml に反映してください", out)

    (HERE / "logs" / "last_create_result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
