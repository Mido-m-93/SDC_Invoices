"""週次レポート（毎週月曜 09:00 JST 実行想定）。

reconcile.detect_alerts をベースに、週次の集計をTeamsへ投稿する。
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml
from dotenv import load_dotenv
from openpyxl import load_workbook

from reconcile import detect_alerts, _rows, _parse_date
from teams_notifier import Alert, post_alerts

HERE = Path(__file__).parent
SCHEMA_PATH = HERE.parent / "sheet_builder" / "schema.yaml"
LOG_DIR = HERE / "logs"

logger = logging.getLogger("weekly_report")


def setup_logging(log_file: Path) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.FileHandler(log_file, encoding="utf-8"), logging.StreamHandler(sys.stdout)],
    )


def build_summary(xlsx: Path) -> list[Alert]:
    wb = load_workbook(xlsx, data_only=True)
    invoices = _rows(wb["20_T_請求明細"])
    receipts = _rows(wb["21_T_入金明細"])
    payments = _rows(wb["22_T_支払明細"])

    today = date.today()
    week_ago = today - timedelta(days=7)

    def _in_range(v, start, end):
        d = _parse_date(v)
        return d is not None and start <= d <= end

    issued_week = [i for i in invoices if _in_range(i.get("issue_date"), week_ago, today)]
    received_week = [r for r in receipts if _in_range(r.get("received_date") or r.get("date"), week_ago, today)]
    paid_week = [p for p in payments if _in_range(p.get("paid_date") or p.get("date"), week_ago, today)]

    issued_amt = sum(float(i.get("amount_incl_tax") or 0) for i in issued_week)
    received_amt = sum(float(r.get("amount") or 0) for r in received_week)
    paid_amt = sum(float(p.get("amount") or 0) for p in paid_week)

    alerts = detect_alerts(xlsx)
    critical = sum(1 for a in alerts if a.severity == "🔴")
    warn = sum(1 for a in alerts if a.severity == "🟠")

    summary = Alert(
        severity="🟡",
        category="weekly_summary",
        title=f"週次レポート ({week_ago} 〜 {today})",
        message="過去7日間の請求・入金・支払サマリ",
        fields={
            "発行請求書": f"{len(issued_week)}件 / ¥{issued_amt:,.0f}",
            "入金": f"{len(received_week)}件 / ¥{received_amt:,.0f}",
            "支払": f"{len(paid_week)}件 / ¥{paid_amt:,.0f}",
            "🔴 critical": str(critical),
            "🟠 warning": str(warn),
            "アラート合計": str(len(alerts)),
        },
    )
    return [summary] + alerts[:10]  # サマリ + 上位10件


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prod", action="store_true")
    args = parser.parse_args()
    setup_logging(LOG_DIR / f"weekly_report_{datetime.now():%Y-%m-%d}.log")

    with SCHEMA_PATH.open(encoding="utf-8") as f:
        schema = yaml.safe_load(f)
    xlsx = Path(schema["workbook"]["sandbox_dir"]) / schema["workbook"]["filename"]
    load_dotenv(HERE / ".env")

    alerts = build_summary(xlsx)
    post_alerts(alerts, prod=args.prod, title="RCP 週次レポート")
    return 0


if __name__ == "__main__":
    sys.exit(main())
