"""Validation helpers for academic-year and semester identifiers."""

from __future__ import annotations

import re
from datetime import date
from typing import Tuple


ACADEMIC_YEAR_RE = re.compile(r"^(?P<start>\d{2})-(?P<end>\d{2})$")
SEMESTER_RE = re.compile(r"^(?P<year>\d{2}-\d{2})-(?P<term>[123])$")


def validate_academic_year(value: str) -> str:
    academic_year = str(value or "").strip()
    match = ACADEMIC_YEAR_RE.fullmatch(academic_year)
    if not match:
        raise ValueError("学年格式必须为 yy-yy，如 26-27")

    start = int(match.group("start"))
    end = int(match.group("end"))
    if end != (start + 1) % 100:
        raise ValueError("学年后两位必须是前两位的下一年")
    return academic_year


def parse_semester_name(value: str) -> Tuple[str, int]:
    semester_name = str(value or "").strip()
    match = SEMESTER_RE.fullmatch(semester_name)
    if not match:
        raise ValueError("学期格式必须为 yy-yy-{1,2,3}")
    academic_year = validate_academic_year(match.group("year"))
    return academic_year, int(match.group("term"))


def build_semester_name(academic_year: str, term: int) -> str:
    year = validate_academic_year(academic_year)
    term_value = int(term)
    if term_value not in (1, 2, 3):
        raise ValueError("学期序号只能是 1、2 或 3")
    return f"{year}-{term_value}"


def parse_first_week_monday(value: str | None, *, required: bool) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        if required:
            raise ValueError("创建学期时必须提供第一周周一日期")
        return None
    try:
        parsed = date.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError("第一周周一日期格式必须为 YYYY-MM-DD") from exc
    if parsed.weekday() != 0:
        raise ValueError("第一周周一日期必须是星期一")
    return parsed
