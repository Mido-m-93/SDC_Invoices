"""MF OAuth2 再認可スクリプト。

RTが失効した場合に使用。ブラウザでMFにログインしてコードを取得し、
新しいaccess_token + refresh_tokenを発行して 1Password を更新する。

実行方法:
    op run --env-file=/tmp/mf_op_env.txt -- python mf_reauth.py

環境変数（op run で注入）:
    MF_CLIENT_ID / MF_CLIENT_SECRET / MF_SCOPE
    MF_REDIRECT_URI（省略時: http://localhost:8080/callback）
"""

from __future__ import annotations

import os
import subprocess
import sys
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")

CLIENT_ID = os.environ["MF_CLIENT_ID"]
CLIENT_SECRET = os.environ["MF_CLIENT_SECRET"]
SCOPE = os.environ.get("MF_SCOPE", "mfc/invoice/data.read")
REDIRECT_URI = os.environ.get("MF_REDIRECT_URI", "http://localhost:8080/callback")

AUTH_URL = "https://api.biz.moneyforward.com/authorize"
TOKEN_URL = "https://api.biz.moneyforward.com/token"

OP_CLI_PATH = os.environ.get(
    "OP_CLI_PATH",
    "C:/Users/jinta/AppData/Local/Microsoft/WinGet/Packages/"
    "AgileBits.1Password.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe/op.exe",
)
OP_VAULT = "AI-Agents"

# コールバックで受け取ったコードを保持する
_received_code: str | None = None


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        global _received_code
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if "code" in params:
            _received_code = params["code"][0]
            self.send_response(200)
            self.end_headers()
            self.wfile.write("<h1>OK! Claude Code に戻ってください。</h1>".encode("utf-8"))
        else:
            self.send_response(400)
            self.end_headers()
            self.wfile.write("<h1>code が取得できませんでした。</h1>".encode("utf-8"))

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass  # サーバーログを抑制


def build_auth_url() -> str:
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
    }
    return AUTH_URL + "?" + urllib.parse.urlencode(params)


def exchange_code(code: str) -> dict:
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
        },
        auth=(CLIENT_ID, CLIENT_SECRET),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def save_to_1password(item_name: str, credential: str) -> bool:
    try:
        result = subprocess.run(
            [OP_CLI_PATH, "item", "edit", item_name,
             f"credential={credential}", f"--vault={OP_VAULT}"],
            check=True, capture_output=True, text=True, timeout=30,
            encoding="utf-8", errors="replace",
        )
        return True
    except Exception as e:
        print(f"[WARN] 1Password 書き戻し失敗 ({item_name}): {e}")
        return False


def main() -> None:
    print("=== MF OAuth2 再認可 ===")
    print(f"Scope: {SCOPE}")
    print(f"Redirect URI: {REDIRECT_URI}")

    auth_url = build_auth_url()
    print(f"\n認可URL:\n{auth_url}\n")
    print("ブラウザを開きます…（自動で開かない場合は上のURLを貼り付けてください）")
    webbrowser.open(auth_url)

    # ローカルサーバーでコールバック待ち
    port = int(REDIRECT_URI.split(":")[-1].split("/")[0])
    server = HTTPServer(("localhost", port), CallbackHandler)
    print(f"localhost:{port} でコールバック待機中…")
    while _received_code is None:
        server.handle_request()
    server.server_close()

    print(f"\n認可コード受信: {_received_code[:8]}...")
    print("トークン交換中…")

    tokens = exchange_code(_received_code)
    access_token = tokens["access_token"]
    refresh_token = tokens["refresh_token"]

    print(f"access_token: {access_token[:8]}... (expires_in={tokens.get('expires_in')}s)")
    print(f"refresh_token: {refresh_token[:8]}...")

    # 1Password に書き戻す
    print("\n1Password に書き戻し中…")
    rt_ok = save_to_1password("MF Refresh Token", refresh_token)
    at_ok = save_to_1password("MF Access Token", access_token)

    if rt_ok and at_ok:
        print("✅ 1Password 更新完了（MF Refresh Token / MF Access Token）")
    elif rt_ok:
        print("✅ MF Refresh Token 更新完了（Access Token は手動で更新してください）")
    else:
        print("\n⚠️ 1Password への書き戻しに失敗しました。以下のトークンを手動で保存してください:")
        print(f"  MF_REFRESH_TOKEN={refresh_token}")
        print(f"  MF_ACCESS_TOKEN={access_token}")

    print("\n完了。sync_partners.py --dry-run で動作確認してください。")


if __name__ == "__main__":
    main()
