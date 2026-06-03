"""notion_sync の日次エントリ。

Task Scheduler から呼ばれる想定。デフォルトは --dry-run で安全側。
本番稼働は --apply を明示。
"""

from __future__ import annotations

import argparse
import sys

import merge_pipeline


def main() -> int:
    parser = argparse.ArgumentParser(description="Notion日次同期ランナー")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--mock", action="store_true")
    args = parser.parse_args()

    forward: list[str] = []
    if args.apply:
        forward.append("--apply")
    elif args.mock:
        forward.append("--mock")
    else:
        forward.append("--dry-run")

    sys.argv = ["merge_pipeline.py", *forward]
    return merge_pipeline.main()


if __name__ == "__main__":
    sys.exit(main())
