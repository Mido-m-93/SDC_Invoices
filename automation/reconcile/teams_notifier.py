"""Microsoft Teams Incoming Webhook へ Adaptive Card を投稿。

Safety:
    --prod を付けないと TEAMS_WEBHOOK_URL_TEST に投稿（デフォルト）
    --prod 指定時のみ TEAMS_WEBHOOK_URL（本番・経理チャネル）に投稿
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

import pymsteams

logger = logging.getLogger(__name__)


SEVERITY_COLORS = {
    "🔴": "D13438",  # critical
    "🟠": "F7630C",  # warn
    "🟡": "FFB900",  # info
    "🟢": "107C10",  # ok
}


@dataclass
class Alert:
    severity: str  # 🔴 / 🟠 / 🟡 / 🟢
    category: str
    title: str
    message: str
    fields: dict[str, str] = field(default_factory=dict)
    action_url: str | None = None
    action_label: str | None = None


def _pick_webhook(use_prod: bool) -> str | None:
    if use_prod:
        return os.environ.get("TEAMS_WEBHOOK_URL")
    return os.environ.get("TEAMS_WEBHOOK_URL_TEST") or os.environ.get("TEAMS_WEBHOOK_URL")


def post_alerts(alerts: list[Alert], *, prod: bool = False, title: str = "RCP自動チェック") -> bool:
    webhook = _pick_webhook(prod)
    if not webhook:
        logger.warning("TEAMS_WEBHOOK_URL%s 未設定。コンソール出力で代替します",
                       "" if prod else "_TEST")
        for a in alerts:
            logger.info("[%s] %s: %s", a.severity, a.category, a.title)
        return False

    if not alerts:
        logger.info("アラートなし。投稿スキップ")
        return True

    # severity順にソート（🔴 > 🟠 > 🟡 > 🟢）
    order = {"🔴": 0, "🟠": 1, "🟡": 2, "🟢": 3}
    alerts = sorted(alerts, key=lambda a: order.get(a.severity, 9))

    msg = pymsteams.connectorcard(webhook)
    top = alerts[0]
    msg.title(f"{top.severity} {title} ({len(alerts)}件)")
    msg.summary(title)
    msg.color(SEVERITY_COLORS.get(top.severity, "2563EB"))

    for a in alerts[:20]:  # 最大20件まで
        section = pymsteams.cardsection()
        section.activityTitle(f"{a.severity} {a.title}")
        section.activitySubtitle(a.category)
        if a.message:
            section.text(a.message)
        for k, v in a.fields.items():
            section.addFact(k, str(v))
        if a.action_url and a.action_label:
            section.linkButton(a.action_label, a.action_url)
        msg.addSection(section)

    if len(alerts) > 20:
        extra = pymsteams.cardsection()
        extra.text(f"…他 {len(alerts) - 20} 件のアラートがあります。31_V_週次チェック を参照。")
        msg.addSection(extra)

    try:
        msg.send()
        logger.info("Teams投稿成功 (%s, %d件)", "PROD" if prod else "TEST", len(alerts))
        return True
    except Exception as e:
        logger.exception("Teams投稿失敗: %s", e)
        return False
