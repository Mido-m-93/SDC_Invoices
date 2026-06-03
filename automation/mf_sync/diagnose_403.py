"""MF Invoice API 接続性・権限 切り分けスクリプト。

前提:
    .env に MF_CLIENT_ID / MF_CLIENT_SECRET / MF_REFRESH_TOKEN / MF_SCOPE
    OP_SERVICE_ACCOUNT_TOKEN がユーザー環境変数にあれば、refresh 成功時に
    ローテした新 RT を 1Password に自動書き戻し（使い捨てトークンの取りこぼし防止）。

実行: python diagnose_403.py
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")

CLIENT_ID = os.environ["MF_CLIENT_ID"]
CLIENT_SECRET = os.environ["MF_CLIENT_SECRET"]
REFRESH_TOKEN = os.environ["MF_REFRESH_TOKEN"]
SCOPE = os.environ.get("MF_SCOPE", "mfc/invoice/data.read")

TOKEN_URL = "https://api.biz.moneyforward.com/token"
INVOICE_API = "https://invoice.moneyforward.com"

OP_PATH = "C:/Users/jinta/AppData/Local/Microsoft/WinGet/Packages/AgileBits.1Password.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe/op.exe"


def banner(s: str) -> None:
    print()
    print("=" * 70)
    print(s)
    print("=" * 70)


def dump_resp(r: requests.Response) -> None:
    print(f"  status: {r.status_code}")
    for h in ("www-authenticate", "x-mfci-error", "x-request-id", "mf-apigw-request-id"):
        if h in r.headers:
            print(f"  {h}: {r.headers[h]}")
    print(f"  body: {r.text[:500]}")


def persist_rotated_rt_to_1password(new_rt: str) -> None:
    """op CLI で 1Password の 'MF Refresh Token' を上書き。OP_SERVICE_ACCOUNT_TOKEN 必須。"""
    if not os.environ.get("OP_SERVICE_ACCOUNT_TOKEN"):
        print("  ⚠ OP_SERVICE_ACCOUNT_TOKEN 未設定。1Password 書き戻しスキップ。")
        return
    try:
        subprocess.run(
            [OP_PATH, "item", "edit", "MF Refresh Token",
             f"credential={new_rt}",
             "--vault=AI-Agents"],
            check=True, capture_output=True, text=True, timeout=30,
        )
        print("  ✅ 1Password 'MF Refresh Token' を最新値に更新。")
        # .env の値も更新
        env_file = HERE / ".env"
        if env_file.exists():
            import re
            text = env_file.read_text(encoding="utf-8")
            text = re.sub(r"^MF_REFRESH_TOKEN=.*$", f"MF_REFRESH_TOKEN={new_rt}",
                          text, flags=re.MULTILINE)
            env_file.write_text(text, encoding="utf-8")
            print(f"  ✅ .env も更新。")
    except Exception as e:
        print(f"  ❌ 1Password 書き戻し失敗: {e}")


def refresh_token() -> tuple[str, dict] | None:
    banner("STEP 1: refresh_token で access_token 取得")
    r = requests.post(
        TOKEN_URL,
        data={"grant_type": "refresh_token", "refresh_token": REFRESH_TOKEN, "scope": SCOPE},
        auth=(CLIENT_ID, CLIENT_SECRET),  # client_secret_basic
        timeout=30,
    )
    dump_resp(r)
    if r.status_code != 200:
        print("\n❌ refresh 失敗。MF 管理画面で RT を再発行し 1Password に保存して再実行。")
        return None
    tok = r.json()
    print(f"  → access_token len={len(tok['access_token'])} scope={tok.get('scope')!r}")
    if "refresh_token" in tok and tok["refresh_token"] != REFRESH_TOKEN:
        print("  🔄 RT がローテされた。1Password と .env に書き戻します。")
        persist_rotated_rt_to_1password(tok["refresh_token"])
    return tok["access_token"], tok


def probe(at: str, path: str, extra_headers: dict | None = None, base: str = INVOICE_API) -> int:
    headers = {"Authorization": f"Bearer {at}", "Accept": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    url = f"{base}{path}"
    r = requests.get(url, headers=headers, timeout=30)
    print(f"\n  GET {base}{path} (extra={extra_headers})")
    dump_resp(r)
    return r.status_code


def main() -> None:
    out = refresh_token()
    if not out:
        sys.exit(1)
    at, tok = out

    banner("STEP 2: 事業者情報 GET /api/v3/office（単数！offices ではない）")
    probe(at, "/api/v3/office")

    banner("STEP 3: Jin 指示の /api/v3/accounts を素で")
    # invoice.moneyforward.com / api.biz.moneyforward.com の両方試す
    probe(at, "/api/v3/accounts")  # on invoice host
    probe(at, "/api/v3/accounts", base="https://api.biz.moneyforward.com")

    banner("STEP 4: 主要エンドポイントの疎通")
    for path in ["/api/v3/partners", "/api/v3/billings", "/api/v3/quotes", "/api/v3/items"]:
        probe(at, path)

    banner("STEP 5: x-MFCI-Office ヘッダ付きで /api/v3/partners リトライ")
    office_id = os.environ.get("MF_OFFICE_ID", "")
    if office_id:
        probe(at, "/api/v3/partners", extra_headers={"x-MFCI-Office": office_id})
    else:
        print("  .env に MF_OFFICE_ID 未設定。STEP 2 の response から office UUID を取って")
        print("  .env に MF_OFFICE_ID=xxx を追記して再実行。")

    banner("SUMMARY")
    print("""
  403 / 401 の読み方:
  - 401 token_rejected → access_token 期限切れ。refresh 後に再試行。
  - 403 insufficient_permissions → scope 不足 or office 紐付け不足。
      * STEP 2 で 403 → アプリに事業者が紐付いていない
        (MF 管理画面 > クラウドAPI > アプリ > 「事業者を追加」)
      * STEP 4 の特定パスのみ 403 → そのリソースの read 権限が scope に無い
      * STEP 5 で 200 になれば office ヘッダ必須 (mf_client に追加)
  - 404 not_found → path が間違い（本スクリプトでは /office(単数) を使用）

  scope 取得: {scope!r}
    """.format(scope=tok.get("scope")))


if __name__ == "__main__":
    main()
