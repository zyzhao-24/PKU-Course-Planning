#!/usr/bin/env python3
"""将劳动教育课程目录文本转换为课程池 JSON。

该脚本只用于开发阶段整理种子数据，不由后端运行时导入，也不参与发行版打包。
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = ROOT / "demo_data" / "labour" / "copyfrompdf.txt"
DEFAULT_OUTPUT = ROOT / "backend" / "seed_data" / "labor_education_pool.json"
COURSE_SYSTEMS = (
    "全校公选课",
    "专业必修",
    "专业选修",
    "专业任选",
    "实习实践",
    "通选课",
)
COURSE_ID_RE = re.compile(r"^(?P<course_id>[A-Za-z0-9]{8})(?P<tail>.*)$")
ROW_RE = re.compile(
    r"^(?P<name>.*?)"
    r"(?P<course_system>全校公选课|专业必修|专业选修|专业任选|实习实践|通选课)\s*"
    r"(?P<credits>\d+(?:\.\d+)?)\s+"
    r"(?P<labor_hours>\d+(?:\.\d+)?)\s*$"
)


def load_department_map() -> Dict[str, str]:
    """读取现有数据整理脚本中的院系编码关系。"""
    source = ROOT / "data" / "FormatRawData.py"
    if not source.exists():
        return {}
    mapping: Dict[str, str] = {}
    pattern = re.compile(r'^\s*["\'](?P<name>.+?)["\']\s*:\s*["\'](?P<code>\d+)["\']')
    for line in source.read_text(encoding="utf-8").splitlines():
        match = pattern.match(line)
        if match:
            mapping[match.group("code")] = match.group("name")
    return mapping


def strip_department(course_id: str, tail: str, department_map: Dict[str, str]) -> str:
    """按课程号前缀优先、院系名称兜底去除开课院系。"""
    candidates: List[str] = []
    if course_id[:3].isdigit():
        code = f"00{course_id[:3]}"
        if code in department_map:
            candidates.append(department_map[code])
    candidates.extend(sorted(department_map.values(), key=len, reverse=True))
    for department in candidates:
        if tail.startswith(department):
            return tail[len(department):]
    return tail


def parse_line(line: str, line_number: int, department_map: Dict[str, str]) -> Tuple[dict | None, List[str]]:
    warnings: List[str] = []
    stripped = line.strip()
    if not stripped or not re.match(r"^\d+\s*", stripped):
        return None, warnings

    body = re.sub(r"^\d+\s*", "", stripped, count=1)
    match = COURSE_ID_RE.match(body)
    if not match:
        warnings.append(f"line {line_number}: cannot find an 8-character course_id: {line}")
        return None, warnings

    course_id = match.group("course_id")
    if not course_id.isdigit():
        warnings.append(f"line {line_number}: non-numeric course_id preserved: {course_id}")
    tail = strip_department(course_id, match.group("tail"), department_map)
    fields = ROW_RE.match(tail)
    if not fields:
        warnings.append(f"line {line_number}: cannot parse course fields: {line}")
        return None, warnings

    course_name = fields.group("name").strip()
    if not course_name:
        warnings.append(f"line {line_number}: empty course_name: {line}")
        return None, warnings

    return {
        "course_id": course_id,
        "course_name": course_name,
        "course_system": fields.group("course_system"),
        "credits": float(fields.group("credits")),
        "labor_hours": float(fields.group("labor_hours")),
    }, warnings


def parse_source(text: str) -> Tuple[List[dict], List[str]]:
    department_map = load_department_map()
    entries: List[dict] = []
    warnings: List[str] = []
    seen = set()
    for line_number, line in enumerate(text.splitlines(), 1):
        entry, line_warnings = parse_line(line, line_number, department_map)
        warnings.extend(line_warnings)
        if not entry:
            continue
        if entry["course_id"] in seen:
            warnings.append(f"line {line_number}: duplicate course_id skipped: {entry['course_id']}")
            continue
        seen.add(entry["course_id"])
        entries.append(entry)
    return entries, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("output", nargs="?", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    entries, warnings = parse_source(args.input.read_text(encoding="utf-8"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(entries)} entries to {args.output}")
    for warning in warnings:
        print(f"WARNING: {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

