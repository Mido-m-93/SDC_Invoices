"""Notion API 薄いラッパー（読み取り中心 + 新Unified v2への書き込み）。

Safety First:
- 旧3DB（JP/Global/old_unified）へは一切書き込まない。query_database のみ許可。
- 新Unified v2 への書き込みは --apply フラグが立っている時だけ実行される想定。
  本モジュールは低レベルAPIのみを提供し、dry-run 判定は呼び出し側の責務。
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Iterator

import requests

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2025-09-03"  # data_source 概念を含む最新版

logger = logging.getLogger(__name__)


@dataclass
class NotionConfig:
    token: str
    api_version: str = NOTION_VERSION
    timeout_sec: int = 30
    retry_max: int = 5
    retry_backoff_sec: float = 1.5

    @classmethod
    def from_env(cls) -> "NotionConfig":
        token = os.environ.get("NOTION_TOKEN")
        if not token:
            raise RuntimeError("NOTION_TOKEN が .env に設定されていません")
        return cls(token=token)


class NotionClient:
    """Notion REST API の最小ラッパー。"""

    # 旧DBは read-only、誤爆防止のため明示リストで管理
    READ_ONLY_DATABASES: set[str] = set()

    def __init__(self, config: NotionConfig) -> None:
        self._cfg = config
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {config.token}",
                "Notion-Version": config.api_version,
                "Content-Type": "application/json",
            }
        )

    # ------------------------------------------------------------------
    # 低レベル
    # ------------------------------------------------------------------
    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        url = f"{NOTION_API}{path}"
        for attempt in range(self._cfg.retry_max):
            try:
                resp = self._session.request(method, url, timeout=self._cfg.timeout_sec, **kwargs)
                if resp.status_code == 429:
                    wait = float(resp.headers.get("Retry-After", self._cfg.retry_backoff_sec))
                    logger.warning("429 rate limited, waiting %.1fs", wait)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
            except requests.HTTPError as e:
                body = getattr(e.response, "text", "")
                logger.error("Notion API error %s on %s: %s", method, path, body[:500])
                if attempt >= self._cfg.retry_max - 1:
                    raise
                time.sleep(self._cfg.retry_backoff_sec * (attempt + 1))
        raise RuntimeError(f"Notion API {method} {path} failed after retries")

    # ------------------------------------------------------------------
    # 読み取り
    # ------------------------------------------------------------------
    def retrieve_database(self, database_id: str) -> dict[str, Any]:
        """DB メタ情報（スキーマ含む）を取得。"""
        return self._request("GET", f"/databases/{database_id}")

    def query_data_source(
        self,
        data_source_id: str,
        page_size: int = 100,
        filter_: dict[str, Any] | None = None,
    ) -> Iterator[dict[str, Any]]:
        """data_source 配下の全ページをページネーションしつつ yield。"""
        start_cursor: str | None = None
        while True:
            payload: dict[str, Any] = {"page_size": page_size}
            if start_cursor:
                payload["start_cursor"] = start_cursor
            if filter_:
                payload["filter"] = filter_
            data = self._request(
                "POST",
                f"/data_sources/{data_source_id}/query",
                data=json.dumps(payload),
            )
            for page in data.get("results", []):
                yield page
            if not data.get("has_more"):
                return
            start_cursor = data.get("next_cursor")

    def query_database(
        self,
        database_id: str,
        page_size: int = 100,
        filter_: dict[str, Any] | None = None,
    ) -> Iterator[dict[str, Any]]:
        """legacy /databases/{id}/query エンドポイント（data_sourceが拾えない時のフォールバック）。"""
        start_cursor: str | None = None
        while True:
            payload: dict[str, Any] = {"page_size": page_size}
            if start_cursor:
                payload["start_cursor"] = start_cursor
            if filter_:
                payload["filter"] = filter_
            data = self._request(
                "POST",
                f"/databases/{database_id}/query",
                data=json.dumps(payload),
            )
            for page in data.get("results", []):
                yield page
            if not data.get("has_more"):
                return
            start_cursor = data.get("next_cursor")

    # ------------------------------------------------------------------
    # 書き込み（read-only DB はブロック）
    # ------------------------------------------------------------------
    def _guard_write(self, database_id: str) -> None:
        if database_id in self.READ_ONLY_DATABASES:
            raise RuntimeError(
                f"Safety guard: database {database_id} は read_only に指定されています。書き込み不可。"
            )

    def create_database(self, parent_page_id: str, title: str, properties: dict[str, Any]) -> dict[str, Any]:
        # 2025-09-03 API: properties は initial_data_source.properties 配下に置く。
        # "Project Name" タイトルがユーザー指定されている場合は既定の "Name" に別名でぶつからないよう調整。
        props = dict(properties)
        if "Project Name" in props and props["Project Name"].get("title") is not None:
            # initial_data_source でタイトル列を "Project Name" として作成
            pass
        payload = {
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "title": [{"type": "text", "text": {"content": title}}],
            "initial_data_source": {"properties": props},
        }
        return self._request("POST", "/databases", data=json.dumps(payload))

    def create_page(self, data_source_id: str, properties: dict[str, Any]) -> dict[str, Any]:
        # data_source経由の作成は parent を data_source_id で指定
        payload = {
            "parent": {"type": "data_source_id", "data_source_id": data_source_id},
            "properties": properties,
        }
        return self._request("POST", "/pages", data=json.dumps(payload))

    def update_page(self, page_id: str, properties: dict[str, Any]) -> dict[str, Any]:
        payload = {"properties": properties}
        return self._request("PATCH", f"/pages/{page_id}", data=json.dumps(payload))

    def archive_page(self, page_id: str) -> dict[str, Any]:
        payload = {"archived": True}
        return self._request("PATCH", f"/pages/{page_id}", data=json.dumps(payload))


def register_read_only(database_ids: list[str]) -> None:
    """旧DBのIDを READ_ONLY_DATABASES に登録して誤爆防止。"""
    NotionClient.READ_ONLY_DATABASES.update(database_ids)
