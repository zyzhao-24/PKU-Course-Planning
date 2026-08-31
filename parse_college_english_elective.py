#!/usr/bin/env python3
"""Parse copied elective-page college English rows into course-pool JSON.

Default input:
    demo_data/english/copy_from_elective.txt

Default output:
    data/college_english_pool.json

The generated course list is source data. Runtime metadata lives in
backend/resources/college_english.json.
This helper is intentionally kept at the project root and is not included in
the packaged app.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


DEFAULT_INPUT = Path("demo_data/english/copy_from_elective.txt")
DEFAULT_OUTPUT = Path("data/college_english_pool.json")

MODULE_ORDER = {
    "Y": 0,
    "A": 1,
    "B": 2,
    "C": 3,
    "C_PLUS": 4,
}

COURSE_ROW_RE = re.compile(r"^\s*(\d{8})\t")
LEVEL_SUFFIX_RE = re.compile(
    r"\s*[\(\uff08]\s*(?:Y|A|B|C|C[+\uff0b])\s*(?:\u7ea7)?\s*[\)\uff09]?\s*$",
    re.IGNORECASE,
)
C_PLUS_COURSE_NAME_MARKERS = {
    "\u6279\u5224\u6027\u601d\u7ef4\u4e0e\u5b66\u672f\u5199\u4f5c",
}


def read_text(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text()


def clean_course_name(raw_name: str) -> str:
    return LEVEL_SUFFIX_RE.sub("", raw_name.strip()).strip()


def normalize_module(raw_level: str, course_name: str) -> str | None:
    if any(marker in course_name for marker in C_PLUS_COURSE_NAME_MARKERS):
        return "C_PLUS"

    value = (
        raw_level.strip()
        .upper()
        .replace(" ", "")
        .replace("\uff0b", "+")
        .replace("\u7ea7", "")
    )
    if value in {"Y", "A", "B", "C"}:
        return value
    if value in {"C+", "CPLUS", "C_PLUS"}:
        return "C_PLUS"

    suffix_match = LEVEL_SUFFIX_RE.search(course_name)
    if suffix_match:
        suffix = suffix_match.group(0)
        normalized_suffix = (
            suffix.upper()
            .replace("\uff0b", "+")
            .replace("\u7ea7", "")
        )
        if "C+" in normalized_suffix:
            return "C_PLUS"
        for module in ("Y", "A", "B", "C"):
            if module in normalized_suffix:
                return module

    return None


def iter_course_rows(text: str) -> Iterable[Tuple[int, List[str]]]:
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not COURSE_ROW_RE.match(line):
            continue
        fields = [field.strip() for field in line.split("\t")]
        if len(fields) >= 5:
            yield line_number, fields


def parse_entries(text: str) -> Tuple[List[Dict], Dict[str, int], List[str]]:
    seen: Dict[Tuple[str, str], Dict] = {}
    skipped: List[str] = []
    stats = {
        "rows": 0,
        "duplicates": 0,
        "name_conflicts": 0,
        "skipped": 0,
    }

    for line_number, fields in iter_course_rows(text):
        stats["rows"] += 1
        course_id = fields[0]
        raw_name = fields[1]
        raw_level = fields[2]
        module = normalize_module(raw_level, raw_name)
        if not module:
            stats["skipped"] += 1
            skipped.append(
                f"line {line_number}: unknown module {raw_level!r} for {course_id} {raw_name!r}"
            )
            continue

        course_name = clean_course_name(raw_name)
        key = (course_id, module)
        existing = seen.get(key)
        if existing:
            stats["duplicates"] += 1
            if existing["course_name"] != course_name:
                stats["name_conflicts"] += 1
                existing.setdefault("alternate_names", [])
                if course_name not in existing["alternate_names"]:
                    existing["alternate_names"].append(course_name)
            continue

        seen[key] = {
            "course_id": course_id,
            "course_name": course_name,
            "module": module,
            "_line_number": line_number,
        }

    entries = sorted(
        seen.values(),
        key=lambda item: (
            MODULE_ORDER.get(item["module"], 99),
            item["course_id"],
            item["course_name"],
            item["_line_number"],
        ),
    )

    for entry in entries:
        entry.pop("_line_number", None)
        entry.pop("alternate_names", None)

    return entries, stats, skipped


def write_json(entries: List[Dict], output: Path | None) -> None:
    payload = json.dumps(entries, ensure_ascii=False, indent=2)
    if output is None:
        sys.stdout.write(payload)
        sys.stdout.write("\n")
        return

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(payload + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Parse copied elective-page college English data into pool JSON."
    )
    parser.add_argument(
        "input",
        nargs="?",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"Copied elective text file. Default: {DEFAULT_INPUT}",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"JSON output path. Use '-' for stdout. Default: {DEFAULT_OUTPUT}",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    input_path: Path = args.input
    output_path = None if str(args.output) == "-" else args.output

    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    entries, stats, skipped = parse_entries(read_text(input_path))
    write_json(entries, output_path)

    destination = "stdout" if output_path is None else str(output_path)
    print(
        "Parsed {rows} rows, wrote {entries} unique entries to {destination} "
        "({duplicates} duplicate class rows skipped).".format(
            rows=stats["rows"],
            entries=len(entries),
            destination=destination,
            duplicates=stats["duplicates"],
        ),
        file=sys.stderr,
    )
    if stats["name_conflicts"]:
        print(f"Name conflicts merged: {stats['name_conflicts']}", file=sys.stderr)
    if skipped:
        print(f"Skipped rows: {len(skipped)}", file=sys.stderr)
        for message in skipped[:20]:
            print(f"  {message}", file=sys.stderr)
        if len(skipped) > 20:
            print(f"  ... {len(skipped) - 20} more", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
