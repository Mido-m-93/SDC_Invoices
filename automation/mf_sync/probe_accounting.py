"""MF accounting API 403 詳細調査 — レスポンスbody/全ヘッダーをダンプ。"""
import json
import os
import subprocess
from pathlib import Path

import requests

TOKENS = json.loads(Path.home().joinpath(".nexus/mf_tokens.json").read_text(encoding="utf-8"))
AT = TOKENS["access_token"]
BASE = "https://api-accounting.moneyforward.com"


def op_read(item: str) -> str:
    r = subprocess.run(["op", "read", f"op://AI-Agents/{item}/credential"],
                       capture_output=True, text=True, check=True)
    return r.stdout.strip()


def dump(r: requests.Response, label: str) -> None:
    print(f"\n=== {label} ===")
    print(f"status: {r.status_code}")
    for k, v in r.headers.items():
        if k.lower().startswith(("x-", "www-", "mf-")) or k.lower() in ("content-type",):
            print(f"  {k}: {v}")
    body = r.text
    print(f"  body({len(body)}): {body[:1500]}")


def call(method: str, path: str, headers: dict, body: dict | None = None, label: str = "") -> requests.Response:
    url = BASE + path
    if method == "GET":
        r = requests.get(url, headers=headers, timeout=30)
    else:
        r = requests.post(url, headers=headers, json=body, timeout=30)
    dump(r, label or f"{method} {path}")
    return r


def main() -> None:
    h = {"Authorization": f"Bearer {AT}", "Accept": "application/json"}

    # 1. bare call to see 403 body
    call("GET", "/api/v3/accounts", h, label="1) /api/v3/accounts bare")

    # 2. with x-MFCI-Office: 5101-1881
    h2 = {**h, "x-MFCI-Office": "5101-1881"}
    call("GET", "/api/v3/accounts", h2, label="2) /api/v3/accounts + x-MFCI-Office=5101-1881")

    # 3. try other header name variations
    for hk in ("X-MFCI-Office", "X-Office", "x-office-id", "x-MFCI-OfficeId"):
        hv = {**h, hk: "5101-1881"}
        call("GET", "/api/v3/accounts", hv, label=f"3) accounts + {hk}=5101-1881")

    # 4. Try offices endpoint to see if it returns uuid
    call("GET", "/api/v3/offices", h, label="4) /api/v3/offices bare")

    # 5. Try /me style
    call("GET", "/api/v1/me", h, label="5) /api/v1/me")
    call("GET", "/api/v1/selectable_offices", h, label="6) /api/v1/selectable_offices")


if __name__ == "__main__":
    main()
