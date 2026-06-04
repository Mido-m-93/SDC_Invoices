"""MoneyForward Cloud Invoice API ラッパー（read-onlyスコープ前提）。

OAuth2 Refresh Token Grant で access_token を更新しつつ利用する。
.env の `MF_SCOPE` は accounting + invoice の統合スコープ想定だが、本クラス自体は
`invoice.moneyforward.com/api/v3/*` のみ対象（会計APIは別ホスト・別実装）。

RT ローテーション対策（重要）:
    MF は refresh_token が使い捨てで、毎回新しい RT が返る。これを永続化しないと
    次回 refresh で 401 invalid_refresh_token。本クラスは refresh 成功時に
    1Password（op CLI）と .env の両方に新 RT を書き戻す。

1Password 書き戻しの前提:
    環境変数 `OP_SERVICE_ACCOUNT_TOKEN` が設定されていれば実行、未設定なら
    .env のみ更新してスキップ（ログに警告）。
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

import requests

logger = logging.getLogger(__name__)

# 重要: MF Business の OAuth と API は別ホスト。
#   OAuth (token/authorize): api.biz.moneyforward.com
#   Cloud Invoice API:        invoice.moneyforward.com/api/v3/*
#   （会計API/経費APIは別製品・別ホスト。現段階は invoice のみ実装）
MFC_AUTH_URL = "https://api.biz.moneyforward.com/authorize"
MFC_TOKEN_URL = "https://api.biz.moneyforward.com/token"
MFC_API_BASE = "https://invoice.moneyforward.com"

# 1Password CLI パス（Windows WinGet 既定）
OP_CLI_PATH = os.environ.get(
    "OP_CLI_PATH",
    "C:/Users/jinta/AppData/Local/Microsoft/WinGet/Packages/"
    "AgileBits.1Password.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe/op.exe",
)
OP_VAULT = os.environ.get("OP_VAULT", "AI-Agents")
OP_ITEM_RT = os.environ.get("OP_ITEM_RT", "MF Refresh Token")


@dataclass
class MFConfig:
    client_id: str
    client_secret: str
    refresh_token: str
    scope: str = "mfc/invoice/data.read"
    api_base: str = MFC_API_BASE
    office_id: str | None = None  # x-MFCI-Office ヘッダ用（取得後に追加）
    env_path: Path | None = None  # RT 書き戻し先の .env

    @classmethod
    def from_env(cls, env_path: Path | None = None) -> "MFConfig":
        keys = ["MF_CLIENT_ID", "MF_CLIENT_SECRET", "MF_REFRESH_TOKEN"]
        missing = [k for k in keys if not os.environ.get(k)]
        if missing:
            raise RuntimeError(f".env に未設定: {missing}")
        return cls(
            client_id=os.environ["MF_CLIENT_ID"],
            client_secret=os.environ["MF_CLIENT_SECRET"],
            refresh_token=os.environ["MF_REFRESH_TOKEN"],
            scope=os.environ.get("MF_SCOPE", "mfc/invoice/data.read"),
            office_id=os.environ.get("MF_OFFICE_ID"),
            env_path=env_path,
        )


class MFClient:
    """MF Cloud Invoice API の薄いラッパー（read-only前提）。"""

    def __init__(self, cfg: MFConfig) -> None:
        self._cfg = cfg
        self._access_token: str | None = None
        self._expires_at: float = 0.0
        self._session = requests.Session()

    # ------------------------------------------------------------------
    # OAuth
    # ------------------------------------------------------------------
    def _refresh(self) -> None:
        """refresh_token で access_token を更新。新RTは必ず永続化する。"""
        # client_secret_basic（HTTP Basic Auth）必須。body に client_id を入れると A157304 エラー。
        resp = self._session.post(
            MFC_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": self._cfg.refresh_token,
                "scope": self._cfg.scope,
            },
            auth=(self._cfg.client_id, self._cfg.client_secret),
            timeout=30,
        )
        if resp.status_code != 200:
            logger.error("token refresh 失敗 status=%d body=%s", resp.status_code, resp.text[:500])
        resp.raise_for_status()
        data = resp.json()
        self._access_token = data["access_token"]
        self._expires_at = time.time() + int(data.get("expires_in", 3600)) - 60

        # MF は毎回 RT をローテする。永続化しないと次回 401 になるので必ず書き戻す。
        new_rt = data.get("refresh_token")
        if new_rt and new_rt != self._cfg.refresh_token:
            self._cfg.refresh_token = new_rt
            self._persist_refresh_token(new_rt)

    def _persist_refresh_token(self, new_rt: str) -> None:
        """ローテされた RT を 1Password と .env に書き戻す。"""
        op_ok = self._persist_to_1password(new_rt)
        env_ok = self._persist_to_env(new_rt)
        if op_ok and env_ok:
            logger.info("🔄 RT ローテ: 1Password + .env 両方に書き戻し完了")
        elif op_ok:
            logger.info("🔄 RT ローテ: 1Password に書き戻し完了（.env スキップ）")
        elif env_ok:
            logger.warning("🔄 RT ローテ: .env のみ更新（1Password書き戻しは失敗/スキップ）")
        else:
            logger.error("⚠️ RT ローテしたのにどちらにも書き戻せず。次回 refresh で401必至")

    def _persist_to_1password(self, new_rt: str) -> bool:
        # op run 経由の場合は OP_SERVICE_ACCOUNT_TOKEN がなくても item edit が通る。
        # account list チェックは不要 — 直接 item edit を試みる。
        try:
            subprocess.run(
                [
                    OP_CLI_PATH, "item", "edit", OP_ITEM_RT,
                    f"credential={new_rt}",
                    f"--vault={OP_VAULT}",
                ],
                check=True, capture_output=True, text=True, timeout=30,
                encoding="utf-8", errors="replace",  # Windows cp932 対策
            )
            return True
        except Exception as e:
            logger.error("1Password RT 書き戻し失敗: %s", e)
            return False

    def _persist_to_env(self, new_rt: str) -> bool:
        if not self._cfg.env_path or not self._cfg.env_path.exists():
            return False
        try:
            text = self._cfg.env_path.read_text(encoding="utf-8")
            if re.search(r"^MF_REFRESH_TOKEN=", text, flags=re.MULTILINE):
                text = re.sub(
                    r"^MF_REFRESH_TOKEN=.*$",
                    f"MF_REFRESH_TOKEN={new_rt}",
                    text,
                    flags=re.MULTILINE,
                )
            else:
                if not text.endswith("\n"):
                    text += "\n"
                text += f"MF_REFRESH_TOKEN={new_rt}\n"
            self._cfg.env_path.write_text(text, encoding="utf-8")
            return True
        except Exception as e:
            logger.error(".env RT 書き戻し失敗: %s", e)
            return False

    # ------------------------------------------------------------------
    # リクエスト
    # ------------------------------------------------------------------
    def _headers(self) -> dict[str, str]:
        if not self._access_token or time.time() >= self._expires_at:
            self._refresh()
        h = {
            "Authorization": f"Bearer {self._access_token}",
            "Accept": "application/json",
        }
        if self._cfg.office_id:
            # 一部テナントで必要な事業者指定ヘッダ（Invoice API）
            h["x-MFCI-Office"] = self._cfg.office_id
        return h

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self._cfg.api_base}{path}"
        resp = self._session.get(url, headers=self._headers(), params=params, timeout=30)
        if resp.status_code == 401:
            # トークン切れ想定 → refresh して1回だけ再試行
            self._refresh()
            resp = self._session.get(url, headers=self._headers(), params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def paginated(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        page_key: str = "page",
    ) -> Iterator[dict]:
        """MF Invoice API のページネーション。per_page/page スタイル。"""
        params = dict(params or {})
        params.setdefault("per_page", 100)
        page = 1
        while True:
            params[page_key] = page
            data = self.get(path, params=params)
            items = data.get("data") or data.get("items") or []
            for item in items:
                yield item
            # MF Invoice API は `pagination.total_pages` を返すが、`meta` の場合もあるので両対応
            pagination = data.get("pagination") or data.get("meta") or {}
            total_pages = pagination.get("total_pages") or pagination.get("last_page") or 1
            if page >= int(total_pages) or not items:
                return
            page += 1

    # ------------------------------------------------------------------
    # 高レベルユーティリティ
    # ------------------------------------------------------------------
    # 2026-04 動作確認済: /office, /partners, /billings, /quotes, /items が 200 を返す。
    def get_office(self) -> dict:
        """自分が所属する事業者情報（単数形！）。office_id, office_code 等を含む。"""
        return self.get("/api/v3/office")

    def list_partners(self) -> Iterator[dict]:
        yield from self.paginated("/api/v3/partners")

    def list_invoices(self, since: str | None = None) -> Iterator[dict]:
        """請求書一覧。since は ISO8601 日時文字列で updated_at フィルタ。"""
        params = {"updated_from": since} if since else None
        yield from self.paginated("/api/v3/billings", params=params)

    def list_quotes(self) -> Iterator[dict]:
        yield from self.paginated("/api/v3/quotes")

    def list_items(self) -> Iterator[dict]:
        yield from self.paginated("/api/v3/items")

    def list_transactions(self, from_date: str, to_date: str) -> Iterator[dict]:
        # 会計API (mfc/accounting/*) は別ホスト。ベースURLが公開ドキュメントで未確認のため
        # 現段階では未実装。ドキュメント入手後に別クライアントとして分離する。
        raise NotImplementedError("会計APIは別ホスト。現段階は invoice のみ対応。")
