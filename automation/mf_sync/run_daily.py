"""MF同期日次ランナー。partners → invoices → transactions の順に実行。"""

from __future__ import annotations

import argparse
import sys

import sync_invoices
import sync_partners
import sync_transactions


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--mock", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    flag = "--mock" if args.mock else ("--apply" if args.apply else "--dry-run")

    for mod in (sync_partners, sync_invoices, sync_transactions):
        sys.argv = [mod.__name__ + ".py", flag]
        rc = mod.main()
        if rc != 0:
            return rc
    return 0


if __name__ == "__main__":
    sys.exit(main())
