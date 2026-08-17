"""mf_client.py の動作確認（read-only, 副作用は RT ローテのみ）。

実行:
    python test_client.py

検証項目:
    1. MFConfig.from_env() が env_path 付きで構築できる
    2. get_office() が 200 で office_id を返す
    3. list_partners() が yield でき、最初の1件が取れる
    4. list_invoices() が yield でき、最初の1件が取れる
    5. RT ローテが起きた場合、1Password と .env に書き戻されている
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from mf_client import MFClient, MFConfig, OP_CLI_PATH, OP_ITEM_RT, OP_VAULT

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

HERE = Path(__file__).parent
ENV_FILE = HERE / ".env"
load_dotenv(ENV_FILE)


def read_op_rt() -> str | None:
    if not os.environ.get("OP_SERVICE_ACCOUNT_TOKEN"):
        return None
    import subprocess
    r = subprocess.run(
        [OP_CLI_PATH, "item", "get", OP_ITEM_RT,
         f"--vault={OP_VAULT}", "--fields", "credential", "--reveal"],
        capture_output=True, text=True, timeout=30,
    )
    return r.stdout.strip() if r.returncode == 0 else None


def main() -> int:
    print("=== 1. MFConfig 構築 ===")
    cfg = MFConfig.from_env(env_path=ENV_FILE)
    print(f"  client_id: {cfg.client_id}")
    print(f"  scope: {cfg.scope}")
    print(f"  office_id (env): {cfg.office_id}")
    print(f"  env_path: {cfg.env_path}")

    rt_before_op = read_op_rt()
    rt_before_env = cfg.refresh_token
    print(f"  RT (env)     len={len(rt_before_env)}  ...{rt_before_env[-6:]}")
    print(f"  RT (op)      len={len(rt_before_op) if rt_before_op else 'n/a'}  ...{rt_before_op[-6:] if rt_before_op else 'n/a'}")
    if rt_before_op and rt_before_env != rt_before_op:
        print("  ⚠️ env と 1Password の RT が不一致（ローテ失敗の痕跡）")

    client = MFClient(cfg)

    print("\n=== 2. get_office ===")
    o = client.get_office()
    print(f"  id:   {o.get('id')}")
    print(f"  name: {o.get('name')}")
    print(f"  code: {o.get('office_code')}")
    assert o.get("id"), "office.id が空"

    print("\n=== 3. list_partners (最初の3件) ===")
    for i, p in enumerate(client.list_partners()):
        print(f"  [{i}] {p.get('name')} (id={p.get('id')})")
        if i >= 2:
            break

    print("\n=== 4. list_invoices (最初の3件) ===")
    for i, b in enumerate(client.list_invoices()):
        print(f"  [{i}] {b.get('partner_name')} / {b.get('title') or b.get('billing_number') or b.get('id')}")
        if i >= 2:
            break

    print("\n=== 5. list_items (最初の3件) ===")
    for i, it in enumerate(client.list_items()):
        print(f"  [{i}] {it.get('name')}  price={it.get('price')}")
        if i >= 2:
            break

    print("\n=== 6. RT 永続化確認 ===")
    rt_after_env = cfg.refresh_token
    rt_after_op = read_op_rt()
    rotated = rt_after_env != rt_before_env
    print(f"  RT (env)     len={len(rt_after_env)}  ...{rt_after_env[-6:]}  rotated={rotated}")
    print(f"  RT (op)      len={len(rt_after_op) if rt_after_op else 'n/a'}  ...{rt_after_op[-6:] if rt_after_op else 'n/a'}")
    if rotated:
        # env と op が一致していれば書き戻し成功
        if rt_after_op and rt_after_env == rt_after_op:
            print("  ✅ RT ローテ → 1Password と .env 同期OK")
        else:
            print("  ⚠️ RT ローテしたが 1Password と .env が不一致")
            return 1
    else:
        print("  (このセッションでは RT ローテは起きず)")

    print("\n✅ 全項目パス")
    return 0


if __name__ == "__main__":
    sys.exit(main())
