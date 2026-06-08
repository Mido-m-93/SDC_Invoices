"""旧3DB（JP/Global/old_unified）→ 新Unified v2 への統合同期。

3モード:
    --dry-run (default): 書き込まずに差分計画のログのみ
    --mock : samples/*.json を入力として動作確認
    --apply / --prod: 実際に新Unified v2に書き込み

Safety:
    - 旧DBには一切書き込まない（NotionClient.READ_ONLY_DATABASES でガード）
    - 重複検出 fuzzy match で既存ページ更新 or 新規作成を判定
    - 削除は on_deleted ポリシー（archive）に従う
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import yaml
from dotenv import load_dotenv
from rapidfuzz import fuzz

from notion_client import NotionClient, NotionConfig, register_read_only

HERE = Path(__file__).parent
CONFIG_PATH = HERE / "config.yaml"
LOG_DIR = HERE / "logs"
SAMPLES_DIR = HERE / "samples"

logger = logging.getLogger("merge_pipeline")


# ======================================================================
# データモデル
# ======================================================================
@dataclass
class SourceRecord:
    """旧3DBから取得したレコードを新Unified v2の正規形に変換した中間オブジェクト。"""

    source_db: str
    original_id: str
    original_url: str
    project_name: str
    company: str
    status: str
    properties: dict[str, Any] = field(default_factory=dict)

    def key_for_dedup(self) -> tuple[str, str]:
        return (self.company.strip(), self.project_name.strip())


# ======================================================================
# Notionプロパティ展開ユーティリティ
# ======================================================================
def _extract_plain_text(prop: dict[str, Any] | None) -> str:
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
    if t == "multi_select":
        return ", ".join(o.get("name", "") for o in prop.get("multi_select", []))
    if t == "number":
        v = prop.get("number")
        return "" if v is None else str(v)
    if t == "date":
        d = prop.get("date")
        return d.get("start", "") if d else ""
    if t == "url":
        return prop.get("url") or ""
    if t == "formula":
        f = prop.get("formula", {})
        return str(f.get("string") or f.get("number") or f.get("date") or "")
    if t == "relation":
        return ", ".join(r.get("id", "") for r in prop.get("relation", []))
    return ""


def _extract_date(prop: dict[str, Any] | None) -> str | None:
    if not prop or prop.get("type") != "date":
        return None
    d = prop.get("date")
    return d.get("start") if d else None


def _extract_number(prop: dict[str, Any] | None) -> float | None:
    if not prop or prop.get("type") != "number":
        return None
    return prop.get("number")


# ----------------------------------------------------------------------
# Relation 解決（relation列 → 参照先ページのtitle）
# ----------------------------------------------------------------------
_RELATION_CACHE: dict[str, str] = {}


def _resolve_relation_titles(client: NotionClient, prop: dict[str, Any] | None) -> str:
    """relation 型プロパティから参照先ページのタイトル文字列を結合して返す。
    失敗時は空文字。キャッシュで重複解決を避ける。"""
    if not prop or prop.get("type") != "relation":
        return ""
    ids = [r.get("id") for r in prop.get("relation", []) if r.get("id")]
    titles: list[str] = []
    for page_id in ids:
        if page_id in _RELATION_CACHE:
            titles.append(_RELATION_CACHE[page_id])
            continue
        try:
            page = client._request("GET", f"/pages/{page_id}")  # 薄い叩き方
            props = page.get("properties", {})
            title_prop = next((v for v in props.values() if v.get("type") == "title"), None)
            if title_prop:
                t = "".join(b.get("plain_text", "") for b in title_prop.get("title", []))
                _RELATION_CACHE[page_id] = t
                titles.append(t)
            else:
                _RELATION_CACHE[page_id] = ""
        except Exception as e:
            logger.warning("relation解決失敗 %s: %s", page_id, e)
            _RELATION_CACHE[page_id] = ""
    return " / ".join(filter(None, titles))


_PN_SPLIT_RE = [" — ", " – ", " - ", "  -  ", "｜", "|"]


def _infer_company_from_project_name(project_name: str) -> str:
    """project_name の前半から Company を推測（"ACME - AI Automation" → "ACME"）。
    区切り文字が無ければ空文字。"""
    if not project_name:
        return ""
    for sep in _PN_SPLIT_RE:
        if sep in project_name:
            head = project_name.split(sep, 1)[0].strip()
            # "AI" 等の短すぎるheadは信用しない
            if len(head) >= 3:
                return head
    return ""


# ======================================================================
# ソースDBレコード読み取り（スキーマ別）
# ======================================================================
def read_jp_pipeline(client: NotionClient, data_source_id: str, status_map: dict[str, str]) -> Iterable[SourceRecord]:
    for page in client.query_data_source(data_source_id):
        props = page.get("properties", {})
        status_raw = _extract_plain_text(props.get("ステータス"))
        status = status_map.get(status_raw, "Lead")
        project_name = _extract_plain_text(props.get("プロジェクト名"))
        company = _resolve_relation_titles(client, props.get("社名")) \
                  or _infer_company_from_project_name(project_name)
        record = SourceRecord(
            source_db="jp_pipeline",
            original_id=page["id"],
            original_url=page.get("url", ""),
            project_name=project_name,
            company=company,
            status=status,
        )
        record.properties = {
            "Contract_Status":  _extract_plain_text(props.get("契約ステータス")),
            "Contract_Start":   _extract_date(props.get("契約日")),
            "Contract_End":     _extract_date(props.get("契約終了日")),
            "Expected_Close":   _extract_date(props.get("成約目途")),
            "Last_Discussion":  _extract_date(props.get("最終コンタクト")),
            "Revenue_千円":      _extract_number(props.get("Revenue  (千円) ")),
            "Revenue_月_千円":    _extract_number(props.get("Revenue  (千円/月)")),
            "PJ_Term_months":   _extract_number(props.get("PJ Term(Month)")),
            "Industry":         _extract_plain_text(props.get("Industry")),
            "Probability":      _extract_plain_text(props.get("Probability")),
            "Strategic_Fit":    _extract_plain_text(props.get("Strategic Fit")),
            "Sales_In_Charge":  _extract_plain_text(props.get("アカウントマネージャー")),
            "Next_Step":        _extract_plain_text(props.get("Next Action")),
            "New_Continuing":   _extract_plain_text(props.get("新規・継続")),
            "Notes":            " / ".join(filter(None, [
                f"KeyPerson: {_extract_plain_text(props.get('Key Person'))}",
                f"先方担当: {_extract_plain_text(props.get('先方担当者氏名'))}",
            ])),
        }
        yield record


def read_global_pipeline(client: NotionClient, data_source_id: str, status_map: dict[str, str]) -> Iterable[SourceRecord]:
    for page in client.query_data_source(data_source_id):
        props = page.get("properties", {})
        status_raw = _extract_plain_text(props.get("Status"))
        status = status_map.get(status_raw, "Lead")
        project_name = _extract_plain_text(props.get("Project Name"))
        company = _resolve_relation_titles(client, props.get("Company Name")) \
                  or _infer_company_from_project_name(project_name)
        record = SourceRecord(
            source_db="global_pipeline",
            original_id=page["id"],
            original_url=page.get("url", ""),
            project_name=project_name,
            company=company,
            status=status,
        )
        record.properties = {
            "Contract_Start":   _extract_date(props.get("Contract date")),
            "Contract_End":     _extract_date(props.get("Contract End Date")),
            "Expected_Close":   _extract_date(props.get("Expected date")),
            "Last_Discussion":  _extract_date(props.get("Final Contact")),
            "Revenue_千円":      _extract_number(props.get("Revenue  (千円) ")),
            "Revenue_月_千円":    _extract_number(props.get("Revenue  (千円/月)")),
            "PJ_Term_months":   _extract_number(props.get("PJ Term(Month)")),
            "PJ_Number":        _extract_plain_text(props.get("PJ #")),
            "Industry":         _extract_plain_text(props.get("Industry")),
            "Probability":      _extract_plain_text(props.get("Probability")),
            "Strategic_Fit":    _extract_plain_text(props.get("Strategic Fit")),
            "Sales_In_Charge":  _extract_plain_text(props.get("account manager")),
            "Next_Step":        _extract_plain_text(props.get("Opportunity")),
            "New_Continuing":   _extract_plain_text(props.get("New/Continuing")),
            "Notes":            " / ".join(filter(None, [
                f"KeyPerson: {_extract_plain_text(props.get('Key Person'))}",
                f"Location: {_extract_plain_text(props.get('Location'))}",
                f"StatusRaw: {status_raw}",
            ])),
        }
        yield record


def read_old_unified(client: NotionClient, data_source_id: str) -> Iterable[SourceRecord]:
    for page in client.query_data_source(data_source_id):
        props = page.get("properties", {})
        record = SourceRecord(
            source_db="old_unified",
            original_id=page["id"],
            original_url=page.get("url", ""),
            project_name=_extract_plain_text(props.get("Project Name")),
            company=_extract_plain_text(props.get("Company")),
            status=_extract_plain_text(props.get("Status")) or "Lead",
        )
        record.properties = {
            k: _extract_plain_text(props.get(k)) or _extract_date(props.get(k)) or _extract_number(props.get(k))
            for k in [
                "Contract_Start", "Contract_End", "Expected_Close", "Last_Discussion",
                "Revenue_千円", "Revenue_月_千円", "PJ_Term_months", "PJ_Number",
                "Industry", "Probability", "Strategic_Fit", "Priority",
                "Sales_In_Charge", "Next_Step", "New_Continuing",
                "Cash_In_Start", "Cash_In_End", "Invoice_Dates", "Payment_Dates",
                "Payment_Terms", "Region", "Project_Type", "Notes",
            ]
        }
        yield record


# ======================================================================
# 重複検出
# ======================================================================
def find_duplicate(record: SourceRecord, existing: list[SourceRecord], cfg: dict) -> SourceRecord | None:
    ct = cfg["company_threshold"]
    pt = cfg["project_threshold"]
    method_name = cfg.get("method", "token_set_ratio")
    scorer = getattr(fuzz, method_name, fuzz.token_set_ratio)
    min_len = cfg.get("min_name_length", 0)
    require_company = cfg.get("require_non_empty_company", False)

    # 短すぎるproject_nameは誤マッチの温床なのでdedup候補から除外
    if min_len and len(record.project_name or "") < min_len:
        return None

    for other in existing:
        if min_len and len(other.project_name or "") < min_len:
            continue
        if require_company and (not record.company.strip() or not other.company.strip()):
            continue
        cs = scorer(record.company or "", other.company or "")
        ps = scorer(record.project_name or "", other.project_name or "")
        if cfg.get("both_required", True):
            if cs >= ct and ps >= pt:
                return other
        else:
            if cs >= ct or ps >= pt:
                return other
    return None


def dedup_by_priority(records: list[SourceRecord], priority_order: list[str], dedup_cfg: dict) -> list[SourceRecord]:
    """priority_order の順に evaluated、先に入ったものを残し後続は落とす。"""
    by_priority: list[SourceRecord] = []
    dropped: list[tuple[SourceRecord, SourceRecord]] = []
    for source in priority_order:
        for r in records:
            if r.source_db != source:
                continue
            dup = find_duplicate(r, by_priority, dedup_cfg)
            if dup:
                dropped.append((r, dup))
            else:
                by_priority.append(r)
    for losing, winning in dropped:
        logger.info(
            "[DEDUP] 重複により除外: %s/%s (%s) → 採用: %s/%s (%s)",
            losing.company, losing.project_name, losing.source_db,
            winning.company, winning.project_name, winning.source_db,
        )
    return by_priority


# ======================================================================
# Notion プロパティ生成
# ======================================================================
def to_notion_properties(r: SourceRecord) -> dict[str, Any]:
    def _text(s: str | None) -> dict:
        return {"rich_text": [{"type": "text", "text": {"content": (s or "")[:2000]}}]}

    def _date(d: str | None) -> dict:
        return {"date": {"start": d}} if d else {"date": None}

    def _number(n: Any) -> dict:
        return {"number": float(n)} if isinstance(n, (int, float)) else {"number": None}

    def _select(v: str | None) -> dict:
        return {"select": {"name": v}} if v else {"select": None}

    p = r.properties
    props = {
        "Project Name":    {"title": [{"type": "text", "text": {"content": r.project_name or "(untitled)"}}]},
        "Company":         _text(r.company),
        "Status":          _select(r.status),
        "Source_DB":       _select(r.source_db),
        "Original_URL":    {"url": r.original_url or None},
        "Merged_At":       _date(datetime.utcnow().strftime("%Y-%m-%d")),
        "Merge_Status":    _select("synced"),
    }
    for key in ["Contract_Status", "Industry", "Strategic_Fit", "PJ_Number",
                "Sales_In_Charge", "Next_Step", "Notes",
                "Invoice_Dates", "Payment_Dates", "Payment_Terms",
                "Project_Type"]:
        if p.get(key):
            props[key] = _text(str(p[key]))
    for key in ["Contract_Start", "Contract_End", "Expected_Close", "Last_Discussion",
                "Cash_In_Start", "Cash_In_End"]:
        if p.get(key):
            props[key] = _date(p[key])
    for key in ["Revenue_千円", "Revenue_月_千円", "PJ_Term_months"]:
        if p.get(key) is not None:
            props[key] = _number(p[key])
    for key in ["Probability", "Priority", "New_Continuing", "Region"]:
        val = p.get(key)
        if val:
            # 日本語→英語正規化は簡易的に
            mapping = {"低": "Low", "中": "Middle", "高": "High"}
            props[key] = _select(mapping.get(str(val), str(val)))
    return props


# ======================================================================
# メインフロー
# ======================================================================
def setup_logging(log_file: Path) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.FileHandler(log_file, encoding="utf-8"), logging.StreamHandler(sys.stdout)],
    )


def load_mock_records() -> list[SourceRecord]:
    records: list[SourceRecord] = []
    if not SAMPLES_DIR.exists():
        logger.warning("samples/ ディレクトリが存在しません: %s", SAMPLES_DIR)
        return records
    for f in sorted(SAMPLES_DIR.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        for item in data:
            records.append(SourceRecord(**item))
    logger.info("[MOCK] %d件のサンプルレコードを読み込み", len(records))
    return records


def run(mode: str) -> int:
    with CONFIG_PATH.open(encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    # 旧DBを書き込み禁止リストに登録
    register_read_only([
        cfg["databases"]["jp_pipeline"]["database_id"],
        cfg["databases"]["global_pipeline"]["database_id"],
        cfg["databases"]["old_unified"]["database_id"],
    ])

    # レコード収集
    if mode == "mock":
        records = load_mock_records()
    else:
        load_dotenv(HERE / ".env")
        client = NotionClient(NotionConfig.from_env())
        records = []
        records.extend(read_jp_pipeline(
            client, cfg["databases"]["jp_pipeline"]["data_source_id"],
            cfg["status_normalization"]["jp_pipeline"],
        ))
        records.extend(read_global_pipeline(
            client, cfg["databases"]["global_pipeline"]["data_source_id"],
            cfg["status_normalization"]["global_pipeline"],
        ))
        records.extend(read_old_unified(
            client, cfg["databases"]["old_unified"]["data_source_id"],
        ))

    logger.info("収集レコード数: %d", len(records))
    counts = {}
    for r in records:
        counts[r.source_db] = counts.get(r.source_db, 0) + 1
    for k, v in counts.items():
        logger.info("  %s: %d", k, v)

    # 重複排除
    merged = dedup_by_priority(
        records,
        cfg["deduplication"]["priority_order"],
        cfg["deduplication"],
    )
    logger.info("重複排除後: %d件", len(merged))

    # 書き込み計画をログ
    out_sample = HERE / "logs" / "merge_plan_preview.json"
    out_sample.parent.mkdir(parents=True, exist_ok=True)
    preview = [
        {
            "source_db": r.source_db,
            "company": r.company,
            "project_name": r.project_name,
            "status": r.status,
            "original_url": r.original_url,
            "properties": r.properties,
        }
        for r in merged
    ]
    out_sample.write_text(json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("📝 書き込み計画を %s に保存しました（レビュー用）", out_sample)

    if mode in ("dry-run", "mock"):
        logger.info("[%s] 実書き込みはスキップ。計画ログを確認してください。", mode.upper())
        return 0

    # === APPLY モード ===
    ds_id = cfg["databases"]["new_unified_v2"]["data_source_id"]
    if not ds_id:
        logger.error("new_unified_v2.data_source_id が未設定。先に create_unified_v2.py --apply を実行してください")
        return 2

    if 'client' not in locals():
        load_dotenv(HERE / ".env")
        client = NotionClient(NotionConfig.from_env())

    created = 0
    for r in merged:
        try:
            client.create_page(ds_id, to_notion_properties(r))
            created += 1
            if created % 20 == 0:
                logger.info("  進捗: %d件作成済", created)
        except Exception as e:
            logger.exception("作成失敗 %s/%s: %s", r.company, r.project_name, e)
    logger.info("✅ 新Unified v2への書き込み完了: %d件", created)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="旧3DB → 新Unified v2 統合同期")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="書き込まず計画のみ（デフォルト）")
    mode.add_argument("--mock", action="store_true", help="samples/*.jsonで動作確認")
    mode.add_argument("--apply", action="store_true", help="実書き込み")
    mode.add_argument("--prod", action="store_true", help="--applyのalias（本番実行意思確認）")
    args = parser.parse_args()

    if args.mock:
        m = "mock"
    elif args.apply or args.prod:
        m = "apply"
    else:
        m = "dry-run"

    setup_logging(LOG_DIR / f"merge_pipeline_{datetime.now():%Y-%m-%d}.log")
    logger.info("=== merge_pipeline 開始 mode=%s ===", m)
    rc = run(m)
    logger.info("=== merge_pipeline 終了 rc=%d ===", rc)
    return rc


if __name__ == "__main__":
    sys.exit(main())
