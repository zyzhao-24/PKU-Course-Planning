"""Command line entry point for the program XLS parser."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .parser import parse_xls


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse a PKU program-plan .xls file into structured JSON.")
    parser.add_argument("xls_path", help="Path to the .xls file to parse.")
    parser.add_argument("--output", "-o", help="Optional output JSON path.")
    parser.add_argument("--indent", type=int, default=2, help="JSON indentation level.")
    args = parser.parse_args()

    data = parse_xls(args.xls_path)
    payload = json.dumps(data, ensure_ascii=False, indent=args.indent)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(payload + "\n", encoding="utf-8")
    else:
        sys.stdout.buffer.write((payload + "\n").encode("utf-8"))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
