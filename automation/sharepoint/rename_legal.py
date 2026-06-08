"""Legal フォルダ MECE 構造移行スクリプト。

新構造:
    02_Contracts/
    ├── 01_Client/      ← RCがサービスを提供したクライアント企業
    ├── 02_Vendor/      ← RC が業務委託したベンダー企業
    ├── 03_Member/      ← 個人メンバーへの業務委託
    ├── 04_Partner/     ← MOU・提携先
    └── _OLD/           ← 移行前の全データをコピー保存（読み取り専用扱い）

移行方針:
    - 既存ファイルは _OLD/ にコピー → 削除しない（移行期間中は併存）
    - 新構造へはコピーで移行（元を残す）

使い方:
    python rename_legal.py --dry-run        # 計画表示のみ
    python rename_legal.py --backup         # Phase1: _OLD/ にコピー
    python rename_legal.py --scaffold       # Phase2: 新フォルダ骨格作成
    python rename_legal.py --migrate        # Phase3: 自動分類コピー（Member確定分）
    python rename_legal.py --gen-csv        # Phase4: 企業分類CSV生成 → Jin確認
    python rename_legal.py --apply-csv CSV  # Phase5: CSV反映（Jin確認後）
"""

from __future__ import annotations

import argparse
import csv
import re
import shutil
import sys
from pathlib import Path

LEGAL_BASE = Path(
    "C:/Users/jinta/Robo Co-op/RoboCo-op SharedFiles - Documents"
    "/40_ExpandTogether/02_Functions/07_Legal"
)
CONTRACTS = LEGAL_BASE / "02_Contracts"
SANDBOX = Path("C:/Users/jinta/nexus/pc/sandbox")

NEW_DIRS = ["01_Client", "02_Vendor", "03_Member", "04_Partner", "_OLD"]

# 個人メンバーのフォルダ番号パターン（100番台以上）
MEMBER_NUM_RE = re.compile(r"^1\d{2}_")


# ---------------------------------------------------------------------------
# ユーティリティ
# ---------------------------------------------------------------------------

def _is_individual(folder_name: str) -> bool:
    """100番台以上の番号プレフィックスを持つ = 個人メンバー。"""
    return bool(MEMBER_NUM_RE.match(folder_name))


def _clean_name(folder_name: str) -> str:
    """番号プレフィックス（01_, 105_ 等）を除去して純粋な名前を返す。"""
    return re.sub(r"^\d+_", "", folder_name).strip()


def _copy_tree(src: Path, dst: Path, dry_run: bool) -> int:
    """src → dst に再帰コピー。既存ファイルはスキップ。戻り値はコピー件数。"""
    count = 0
    for item in src.rglob("*"):
        rel = item.relative_to(src)
        target = dst / rel
        if item.is_dir():
            if not dry_run:
                target.mkdir(parents=True, exist_ok=True)
        else:
            if not target.exists():
                if dry_run:
                    print(f"  [COPY] {item.relative_to(CONTRACTS)} → {target.relative_to(CONTRACTS)}")
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(item, target)
                count += 1
    return count


# ---------------------------------------------------------------------------
# Phase 1: _OLD/ バックアップ
# ---------------------------------------------------------------------------

def cmd_backup(dry_run: bool) -> None:
    old_dir = CONTRACTS / "_OLD"
    print(f"Phase1: 現状を _OLD/ にコピー {'[DRY-RUN]' if dry_run else ''}")
    total = 0
    for child in sorted(CONTRACTS.iterdir()):
        if child.name == "_OLD" or not child.is_dir():
            continue
        dst = old_dir / child.name
        cnt = _copy_tree(child, dst, dry_run)
        total += cnt
        print(f"  {child.name}/ → _OLD/{child.name}/  ({cnt}件)")

    # ルート直下のファイルも
    for f in CONTRACTS.iterdir():
        if f.is_file():
            dst = old_dir / f.name
            if not dst.exists():
                if dry_run:
                    print(f"  [COPY] {f.name} → _OLD/{f.name}")
                else:
                    if not dry_run:
                        old_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, dst)
                total += 1

    print(f"\n合計 {total} ファイルを _OLD/ に{'コピー予定' if dry_run else 'コピーしました'}。")


# ---------------------------------------------------------------------------
# Phase 2: 新MECE骨格作成
# ---------------------------------------------------------------------------

def cmd_scaffold(dry_run: bool) -> None:
    print(f"Phase2: 新フォルダ骨格作成 {'[DRY-RUN]' if dry_run else ''}")
    for d in NEW_DIRS:
        p = CONTRACTS / d
        if dry_run:
            print(f"  mkdir {d}/")
        else:
            p.mkdir(exist_ok=True)
            print(f"  created: {d}/")


# ---------------------------------------------------------------------------
# Phase 3: 自動移行（Member確定分）
# ---------------------------------------------------------------------------

def cmd_migrate(dry_run: bool) -> None:
    """
    自動分類できる Member フォルダをコピー:
    1. 業務委託（個人）/ → 03_Member/
    2. 01_締結済契約書/100番台フォルダ → 03_Member/
    3. 01_企業/01_開発・委託案件/ → 01_Client/
    """
    print(f"Phase3: 自動移行 {'[DRY-RUN]' if dry_run else ''}")
    total = 0

    # --- (a) 業務委託（個人）→ 03_Member/
    src_members = CONTRACTS / "業務委託（個人）"
    if src_members.exists():
        for child in sorted(src_members.iterdir()):
            if not child.is_dir():
                continue
            entity_name = _clean_name(child.name)
            dst = CONTRACTS / "03_Member" / entity_name
            cnt = _copy_tree(child, dst, dry_run)
            total += cnt
            print(f"  [Member] {child.name} → 03_Member/{entity_name}  ({cnt}件)")

    # --- (b) 01_締結済契約書/100番台個人 → 03_Member/
    締結 = CONTRACTS / "契約書_対企業体・団体" / "01_締結済契約書"
    if 締結.exists():
        for child in sorted(締結.iterdir()):
            if not child.is_dir():
                continue
            if _is_individual(child.name):
                entity_name = _clean_name(child.name)
                dst = CONTRACTS / "03_Member" / entity_name
                # 既にコピー済みの場合は増分のみ
                cnt = _copy_tree(child, dst, dry_run)
                if cnt or dry_run:
                    print(f"  [Member] 01_締結済/{child.name} → 03_Member/{entity_name}  ({cnt}件)")
                total += cnt

    # --- (c) 01_企業/01_開発・委託案件 → 01_Client/
    client_src = CONTRACTS / "01_企業" / "01_開発・委託案件"
    if client_src.exists():
        for child in sorted(client_src.iterdir()):
            if not child.is_dir():
                continue
            entity_name = _clean_name(child.name)
            dst = CONTRACTS / "01_Client" / entity_name
            cnt = _copy_tree(child, dst, dry_run)
            total += cnt
            print(f"  [Client] {child.name} → 01_Client/{entity_name}  ({cnt}件)")

    print(f"\n合計 {total} ファイルをコピー{'予定' if dry_run else '完了'}。")


# ---------------------------------------------------------------------------
# Phase 4: 企業分類CSV生成
# ---------------------------------------------------------------------------

def cmd_gen_csv() -> None:
    """
    分類が必要な企業フォルダの一覧CSVを生成。
    対象: 01_企業/02_パートナー/ + 01_締結済契約書/1-99番台
    Jin が type 列を Client / Vendor / Partner から選んで保存する。
    """
    rows: list[dict] = []

    # 02_パートナー
    partner_src = CONTRACTS / "01_企業" / "02_パートナー"
    if partner_src.exists():
        for child in sorted(partner_src.iterdir()):
            if not child.is_dir():
                continue
            cnt = sum(1 for _ in child.rglob("*") if _.is_file())
            rows.append({
                "entity_name": _clean_name(child.name),
                "original_folder": str(child.relative_to(CONTRACTS)),
                "file_count": cnt,
                "suggested_type": "Partner",  # デフォルト提案
                "confirmed_type": "",          # Jin が記入
                "note": "",
            })

    # 01_締結済契約書 の 1-99番台（企業）
    締結 = CONTRACTS / "契約書_対企業体・団体" / "01_締結済契約書"
    if 締結.exists():
        for child in sorted(締結.iterdir()):
            if not child.is_dir() or _is_individual(child.name):
                continue
            # 数字なしフォルダ（うむさんラボ等）も含む
            entity_name = _clean_name(child.name)
            cnt = sum(1 for _ in child.rglob("*") if _.is_file())
            # 01_開発・委託案件 に同名があれば Client 候補
            client_src = CONTRACTS / "01_企業" / "01_開発・委託案件"
            is_client_hint = any(
                _clean_name(p.name) == entity_name
                for p in client_src.iterdir()
                if p.is_dir()
            ) if client_src.exists() else False
            rows.append({
                "entity_name": entity_name,
                "original_folder": str(child.relative_to(CONTRACTS)),
                "file_count": cnt,
                "suggested_type": "Client" if is_client_hint else "Partner",
                "confirmed_type": "",
                "note": "01_開発・委託案件にも存在" if is_client_hint else "",
            })

    out = SANDBOX / "legal_entity_mapping.csv"
    SANDBOX.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"CSV生成: {out}")
    print(f"  {len(rows)} 件。'confirmed_type' 列を Client / Vendor / Partner で埋めて保存してください。")


# ---------------------------------------------------------------------------
# Phase 5: CSV反映
# ---------------------------------------------------------------------------

def cmd_apply_csv(csv_path: Path, dry_run: bool) -> None:
    """confirmed_type に従って対象フォルダを新構造にコピー。"""
    type_to_dir = {
        "Client": "01_Client",
        "Vendor": "02_Vendor",
        "Partner": "04_Partner",
    }
    total = 0
    with csv_path.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            confirmed = row.get("confirmed_type", "").strip()
            if confirmed not in type_to_dir:
                print(f"  SKIP (未記入): {row['entity_name']}")
                continue
            src = CONTRACTS / row["original_folder"]
            if not src.exists():
                print(f"  NOT FOUND: {src}")
                continue
            dst_parent = CONTRACTS / type_to_dir[confirmed]
            dst = dst_parent / row["entity_name"]
            cnt = _copy_tree(src, dst, dry_run)
            total += cnt
            print(f"  [{confirmed}] {row['entity_name']} → {type_to_dir[confirmed]}/  ({cnt}件)")
    print(f"\n合計 {total} ファイルをコピー{'予定' if dry_run else '完了'}。")


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Legal フォルダ MECE 移行スクリプト")
    parser.add_argument("--dry-run", action="store_true", help="実際にはコピー/作成しない")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("backup",   help="Phase1: _OLD/ にコピー")
    sub.add_parser("scaffold", help="Phase2: 新フォルダ骨格作成")
    sub.add_parser("migrate",  help="Phase3: Member + Client 自動コピー")
    sub.add_parser("gen-csv",  help="Phase4: 企業分類CSV生成")
    p5 = sub.add_parser("apply-csv", help="Phase5: CSV反映")
    p5.add_argument("csv_path", type=Path, help="legal_entity_mapping.csv のパス")

    args = parser.parse_args()
    dry = args.dry_run

    if args.cmd == "backup":
        cmd_backup(dry)
    elif args.cmd == "scaffold":
        cmd_scaffold(dry)
    elif args.cmd == "migrate":
        cmd_migrate(dry)
    elif args.cmd == "gen-csv":
        cmd_gen_csv()
    elif args.cmd == "apply-csv":
        cmd_apply_csv(args.csv_path, dry)
    else:
        parser.print_help()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
