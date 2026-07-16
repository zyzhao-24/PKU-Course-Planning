"""College English placement rules and default course-pool helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from database import db


ENGLISH_LEVELS = [
    {
        "value": "Y",
        "label": "Y级",
        "summary": "Y级课程 8 学分",
    },
    {
        "value": "A",
        "label": "A级",
        "summary": "A级课程 4 学分 + B级课程 4 学分",
    },
    {
        "value": "B",
        "label": "B级",
        "summary": "B级课程 4 学分 + C级课程 2 学分",
    },
    {
        "value": "C",
        "label": "C级",
        "summary": "C级课程 4 学分，或 C级课程 2 学分 + C+级课程 2 学分",
    },
    {
        "value": "EXEMPT",
        "label": "免修",
        "summary": "免修大学英语要求，自动计 2 学分",
    },
]

ENGLISH_LEVEL_VALUES = {level["value"] for level in ENGLISH_LEVELS}

ENGLISH_MODULES = [
    {"value": "Y", "label": "Y级课程"},
    {"value": "A", "label": "A级课程"},
    {"value": "B", "label": "B级课程"},
    {"value": "C", "label": "C级课程"},
    {"value": "C_PLUS", "label": "C+级课程"},
]

ENGLISH_MODULE_VALUES = {module["value"] for module in ENGLISH_MODULES}

ENGLISH_REQUIREMENT_ALTERNATIVES = {
    "Y": [{"Y": 8.0}],
    "A": [{"A": 4.0, "B": 4.0}],
    "B": [{"B": 4.0, "C": 2.0}],
    "C": [{"C": 4.0}, {"C": 2.0, "C_PLUS": 2.0}],
    "EXEMPT": [{}],
}

DEFAULT_POOL_PATH = Path(__file__).resolve().parent / "seed_data" / "college_english_pool.json"


def get_english_options(current_level: str | None = None) -> Dict[str, Any]:
    return {
        "levels": ENGLISH_LEVELS,
        "modules": ENGLISH_MODULES,
        "requirements": ENGLISH_REQUIREMENT_ALTERNATIVES,
        "current_level": current_level,
    }


def validate_english_level(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    if value not in ENGLISH_LEVEL_VALUES:
        raise ValueError("Invalid college English level")
    return value


def validate_english_module(value: str) -> str:
    if value not in ENGLISH_MODULE_VALUES:
        raise ValueError("Invalid college English module")
    return value


def serialize_pool_item(item) -> Dict[str, Any]:
    return {
        "id": item.id,
        "course_id": item.course_id,
        "course_name": item.course_name,
        "module": item.module,
        "active": item.active,
        "notes": item.notes,
        "order_index": item.order_index,
    }


def load_default_pool_entries() -> List[Dict[str, Any]]:
    if not DEFAULT_POOL_PATH.exists():
        return []
    return json.loads(DEFAULT_POOL_PATH.read_text(encoding="utf-8"))


def seed_default_pool(reset: bool = False) -> int:
    from models import CollegeEnglishCoursePool

    entries = load_default_pool_entries()
    if reset:
        CollegeEnglishCoursePool.query.delete()
    elif CollegeEnglishCoursePool.query.first():
        return 0

    created = 0
    for index, entry in enumerate(entries):
        module = validate_english_module(entry["module"])
        item = CollegeEnglishCoursePool(
            course_id=str(entry["course_id"]).strip(),
            course_name=str(entry["course_name"]).strip(),
            module=module,
            active=bool(entry.get("active", True)),
            notes=entry.get("notes"),
            order_index=entry.get("order_index", index),
        )
        db.session.add(item)
        created += 1

    db.session.commit()
    return created


def requirement_summary(level: str | None) -> str:
    for option in ENGLISH_LEVELS:
        if option["value"] == level:
            return option["summary"]
    return "未设置大学英语分级"


def module_label(module: str) -> str:
    for option in ENGLISH_MODULES:
        if option["value"] == module:
            return option["label"]
    return module


def normalize_name(text: str | None) -> str:
    return "".join((text or "").split())


def is_college_english_node(category_name: str | None, node_name: str | None) -> bool:
    return normalize_name(category_name) == "公共基础课程" and normalize_name(node_name) == "大学英语"
