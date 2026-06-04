"""B-4: Legal フォルダ × Notion v2 × MF Partner の3者マッピング CSV 生成。

Legal の MECE フォルダ構造（01_Client / 02_Vendor / 03_Member / 04_Partner）の
エンティティ名と、Notion v2 の Company 名、MF Partner 名を fuzzy マッチして CSV に出力。

実行:
    python map_contracts.py           # mock MF（samples JSON 使用）
    python map_contracts.py --live    # 本番 MF API 使用
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from rapidfuzz import fuzz

# ---------------------------------------------------------------------------
# パス設定
# ---------------------------------------------------------------------------
HERE = Path(__file__).parent
NOTION_SYNC_DIR = HERE.parent / "notion_sync"
MF_SYNC_DIR = HERE.parent / "mf_sync"
MF_SAMPLES_PATH = MF_SYNC_DIR / "samples" / "mf_partners_samples.json"

LEGAL_BASE = Path("C:/Users/jinta/Robo Co-op/RoboCo-op SharedFiles - Documents"
                  "/40_ExpandTogether/02_Functions/07_Legal/02_Contracts")

OUTPUT_PATH = Path("C:/Users/jinta/nexus/pc/sandbox/contract_entity_map.csv")

# Legal サブフォルダ: (フォルダ名, legal_type ラベル)
LEGAL_CATEGORIES: list[tuple[str, str]] = [
    ("01_Client", "Client"),
    ("02_Vendor", "Vendor"),
    ("03_Member", "Member"),
    ("04_Partner", "Partner"),
]

MATCH_THRESHOLD = 80

logger = logging.getLogger("map_contracts")

# ---------------------------------------------------------------------------
# 名前正規化（sync_partners.py の normalize_name() 準拠）
# ---------------------------------------------------------------------------
_NORMALIZE_PATTERNS = [
    (re.compile(r"(株式会社|\(株\)|㈱)"), ""),
    (re.compile(r"(有限会社|\(有\)|㈲)"), ""),
    (re.compile(r"(合同会社|合資会社|合名会社)"), ""),
    (re.compile(r"(Inc\.?|LLC|Ltd\.?|Corp\.?|Co\.?)", re.IGNORECASE), ""),
    (re.compile(r"一般社団法人|公益社団法人|特定非営利活動法人|NPO法人"), ""),
    (re.compile(r"[\s　・,\.\-（）()]"), ""),
]


def normalize_name(name: str) -> str:
    s = name or ""
    for pat, repl in _NORMALIZE_PATTERNS:
        s = pat.sub(repl, s)
    return s.lower()


# ---------------------------------------------------------------------------
# Notion property helper（fuzzy_dup_review.py から転用）
# ---------------------------------------------------------------------------
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
    if t == "url":
        return prop.get("url") or ""
    return ""


# ---------------------------------------------------------------------------
# Legal フォルダ走査
# ---------------------------------------------------------------------------
def scan_legal_entities() -> list[dict]:
    """各カテゴリの直下ディレクトリをエンティティとして列挙する。"""
    entities: list[dict] = []
    for folder_name, legal_type in LEGAL_CATEGORIES:
        cat_dir = LEGAL_BASE / folder_name
        if not cat_dir.exists():
            logger.warning("Legal カテゴリフォルダが見つかりません: %s", cat_dir)
            continue
        for entry in sorted(cat_dir.iterdir()):
            if not entry.is_dir():
                continue
            # ファイル数（直下のみ）
            file_count = sum(1 for f in entry.iterdir() if f.is_file())
            entities.append({
                "legal_type": legal_type,
                "legal_entity": entry.name,
                "path": entry,
                "file_count": file_count,
            })
    logger.info("Legal エンティティ: %d件", len(entities))
    return entities


# ---------------------------------------------------------------------------
# Notion v2 Company 一覧取得
# ---------------------------------------------------------------------------
def fetch_notion_companies() -> list[dict]:
    """V2_DATA_SOURCE_ID から Company 名と URL を取得する。"""
    sys.path.insert(0, str(NOTION_SYNC_DIR))
    from notion_client import NotionClient, NotionConfig  # type: ignore[import]
    from fuzzy_dup_review import V2_DATA_SOURCE_ID  # type: ignore[import]

    load_dotenv(NOTION_SYNC_DIR / ".env")
    config = NotionConfig.from_env()
    client = NotionClient(config)

    companies: list[dict] = []
    seen_names: set[str] = set()

    print("Notion v2 データを取得中...", flush=True)
    for i, page in enumerate(client.query_data_source(V2_DATA_SOURCE_ID), start=1):
        props = page.get("properties", {})
        company = extract_plain_text(props.get("Company")).strip()
        if not company or company in seen_names:
            continue
        seen_names.add(company)
        companies.append({
            "name": company,
            "url": page.get("url", ""),
        })
        if i % 100 == 0:
            print(f"  fetched {i} pages...", flush=True)

    logger.info("Notion Company（ユニーク）: %d件", len(companies))
    return companies


# ---------------------------------------------------------------------------
# MF Partner 一覧取得
# ---------------------------------------------------------------------------
def load_mf_partners(live: bool) -> list[dict]:
    """live=False なら samples JSON を使用、live=True なら MFClient 経由。"""
    if not live:
        if not MF_SAMPLES_PATH.exists():
            logger.warning("MF サンプルが見つかりません: %s", MF_SAMPLES_PATH)
            return []
        partners = json.loads(MF_SAMPLES_PATH.read_text(encoding="utf-8"))
        logger.info("MF Partner（サンプル）: %d件", len(partners))
        return partners

    # 本番 API
    sys.path.insert(0, str(MF_SYNC_DIR))
    load_dotenv(MF_SYNC_DIR / ".env")
    from mf_client import MFClient, MFConfig  # type: ignore[import]
    client = MFClient(MFConfig.from_env())
    partners = list(client.list_partners())
    logger.info("MF Partner（本番）: %d件", len(partners))
    return partners


# ---------------------------------------------------------------------------
# fuzzy マッチング
# ---------------------------------------------------------------------------
def best_match(
    query_norm: str,
    candidates: list[tuple[dict, str]],
    threshold: int = MATCH_THRESHOLD,
) -> tuple[dict | None, int]:
    """candidates: [(元dict, 正規化済み名前)] のリスト。
    最高スコアの候補と score を返す。threshold 未満は (None, score) で返す。
    """
    best_score = 0
    best_cand: dict | None = None
    for cand, cand_norm in candidates:
        score = fuzz.token_set_ratio(query_norm, cand_norm)
        if score > best_score:
            best_score = score
            best_cand = cand
    if best_score < threshold:
        return None, best_score
    return best_cand, best_score


# ---------------------------------------------------------------------------
# メイン処理
# ---------------------------------------------------------------------------
def run(live: bool) -> int:
    # --- データ収集 ---
    entities = scan_legal_entities()
    if not entities:
        logger.error("Legal エンティティが0件です。パスを確認してください: %s", LEGAL_BASE)
        return 2

    notion_companies = fetch_notion_companies()
    mf_partners = load_mf_partners(live)

    # 正規化済みキャッシュ
    notion_norm = [(c, normalize_name(c["name"])) for c in notion_companies]
    mf_norm = [(p, normalize_name(p["name"])) for p in mf_partners]

    # --- マッピング ---
    rows: list[dict] = []
    for ent in entities:
        entity_norm = normalize_name(ent["legal_entity"])

        notion_cand, n_score = best_match(entity_norm, notion_norm)
        mf_cand, m_score = best_match(entity_norm, mf_norm)

        rows.append({
            "legal_type": ent["legal_type"],
            "legal_entity": ent["legal_entity"],
            "notion_company": notion_cand["name"] if notion_cand else "",
            "notion_score": n_score,
            "notion_url": notion_cand["url"] if notion_cand else "",
            "mf_partner_name": mf_cand["name"] if mf_cand else "",
            "mf_partner_id": mf_cand.get("id", "") if mf_cand else "",
            "mf_score": m_score,
            "file_count": ent["file_count"],
            "note": "",
        })

    # --- CSV 出力 ---
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "legal_type", "legal_entity",
        "notion_company", "notion_score", "notion_url",
        "mf_partner_name", "mf_partner_id", "mf_score",
        "file_count", "note",
    ]
    with OUTPUT_PATH.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n✅ CSV 出力完了: {OUTPUT_PATH}", flush=True)
    print(f"   エンティティ数: {len(rows)}", flush=True)
    matched_notion = sum(1 for r in rows if r["notion_company"])
    matched_mf = sum(1 for r in rows if r["mf_partner_name"])
    print(f"   Notion マッチ: {matched_notion}/{len(rows)}", flush=True)
    print(f"   MF マッチ    : {matched_mf}/{len(rows)}", flush=True)
    return 0


# ---------------------------------------------------------------------------
# エントリポイント
# ---------------------------------------------------------------------------
def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    parser = argparse.ArgumentParser(
        description="Legal × Notion × MF の3者マッピング CSV を生成する"
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="本番 MF API を使用する（デフォルトは samples JSON）",
    )
    args = parser.parse_args()
    return run(live=args.live)


if __name__ == "__main__":
    sys.exit(main())
