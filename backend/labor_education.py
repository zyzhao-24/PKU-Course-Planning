"""劳动教育课程目录及课程池工具。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from database import db


DEFAULT_POOL_PATH = Path(__file__).resolve().parent / "seed_data" / "labor_education_pool.json"


def serialize_pool_item(item) -> Dict[str, Any]:
    return {
        "id": item.id,
        "course_id": item.course_id,
        "course_name": item.course_name,
        "course_system": item.course_system,
        "credits": float(item.credits or 0),
        "labor_hours": float(item.labor_hours or 0),
    }


def load_default_pool_entries() -> List[Dict[str, Any]]:
    if not DEFAULT_POOL_PATH.exists():
        return []
    return json.loads(DEFAULT_POOL_PATH.read_text(encoding="utf-8"))


def _number(value: Any, field: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a number")
    if number < 0:
        raise ValueError(f"{field} must be non-negative")
    return number


def normalize_pool_item(data: Dict[str, Any]) -> Dict[str, Any]:
    course_id = str(data.get("course_id") or "").strip()
    course_name = str(data.get("course_name") or "").strip()
    course_system = str(data.get("course_system") or "").strip()
    if not course_id or not course_name or not course_system:
        raise ValueError("course_id, course_name and course_system are required")
    if len(course_id) != 8:
        raise ValueError("course_id must contain 8 characters")
    return {
        "course_id": course_id,
        "course_name": course_name,
        "course_system": course_system,
        "credits": _number(data.get("credits"), "credits"),
        "labor_hours": _number(data.get("labor_hours"), "labor_hours"),
    }


def seed_default_pool(reset: bool = False) -> int:
    from models import LaborEducationCoursePool

    entries = load_default_pool_entries()
    if reset:
        LaborEducationCoursePool.query.delete()
    elif LaborEducationCoursePool.query.first():
        return 0

    created = 0
    seen = set()
    for entry in entries:
        normalized = normalize_pool_item(entry)
        if normalized["course_id"] in seen:
            raise ValueError(f"duplicate labor education course_id: {normalized['course_id']}")
        seen.add(normalized["course_id"])
        db.session.add(LaborEducationCoursePool(**normalized))
        created += 1

    db.session.commit()
    return created


def is_labor_education_node(node_name: str | None) -> bool:
    return "".join((node_name or "").split()) == "劳动教育课"

