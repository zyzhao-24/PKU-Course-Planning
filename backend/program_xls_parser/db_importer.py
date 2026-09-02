"""Persist parsed program-plan JSON into the redesigned program DB models."""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Optional

from database import db
from models import (
    CourseList,
    MainCategory,
    Node,
    Program,
    ProgramCourseOption,
    ProgramMutualExclusionGroup,
    ProgramMutualExclusionItem,
    ProgramRequirementRule,
)


DEFAULT_MUTUAL_EXCLUSION_STRATEGY = {
    "scope": "program",
    "select": ["has_grade", "higher_credits", "better_score", "lower_order_index"],
    "manual_override": True,
}


def import_parsed_program(
    parsed: Dict[str, Any],
    *,
    name: Optional[str] = None,
    dept: Optional[str] = None,
    channel: int = 0,
    year: Optional[int] = None,
    commit: bool = True,
) -> Program:
    """Create a Program tree from parser output.

    The caller must run this inside an application context.
    """
    metadata = parsed.get("metadata") or {}
    plan_name = name or _metadata_value(metadata, "plan_name") or _metadata_value(metadata, "title") or "未命名培养方案"
    program_year = year or _infer_year(plan_name) or 0

    program = Program(
        name=plan_name,
        dept=dept,
        channel=channel,
        year=program_year,
        source_info=parsed.get("source") or {},
        program_metadata=metadata,
        total_credits=_metadata_value(metadata, "total_credits"),
        raw_payload=parsed,
        import_warnings=parsed.get("warnings") or [],
    )
    db.session.add(program)
    db.session.flush()

    for category_index, category_data in enumerate(parsed.get("categories") or []):
        category = _create_category(program, category_data, category_index)
        for module_index, module_data in enumerate(category_data.get("modules") or []):
            node = _create_module(category, module_data, module_index)
            _create_rules(program.id, "node", node.id, module_data.get("rules") or [], node.source_excel_row)
            _create_mutual_exclusions(
                program.id,
                "node",
                node.id,
                module_data.get("mutual_exclusion") or [],
                node.source_excel_row,
            )

            for group_index, group_data in enumerate(module_data.get("groups") or []):
                course_list = _create_course_list(node, group_data, group_index)
                for course_index, course_data in enumerate(group_data.get("courses") or []):
                    _create_course_option(program.id, course_list.id, course_data, course_index)

    if commit:
        db.session.commit()
    return program


def _create_category(program: Program, data: Dict[str, Any], order_index: int) -> MainCategory:
    requirement = data.get("requirement") or {}
    category = MainCategory(
        program_id=program.id,
        name=data.get("name") or "未命名分类",
        order_index=order_index,
        raw=data.get("raw"),
        remark=data.get("remark"),
        requirement_raw=requirement.get("raw"),
        requirement_type=requirement.get("type"),
        requirement_min=requirement.get("min"),
        requirement_max=requirement.get("max"),
        source_excel_row=data.get("excel_row"),
    )
    db.session.add(category)
    db.session.flush()
    return category


def _create_module(category: MainCategory, data: Dict[str, Any], order_index: int) -> Node:
    requirement = data.get("requirement") or {}
    node = Node(
        main_category_id=category.id,
        parent_id=None,
        name=data.get("name") or "未命名模块",
        order_index=order_index,
        raw=data.get("raw"),
        node_kind="module",
        remark=data.get("remark"),
        requirement_raw=requirement.get("raw"),
        requirement_type=requirement.get("type"),
        requirement_min=requirement.get("min"),
        requirement_max=requirement.get("max"),
        source_excel_row=data.get("excel_row"),
        rules_raw=data.get("rules") or [],
        qualification_rules=_legacy_qualification_rules(requirement),
    )
    db.session.add(node)
    db.session.flush()
    return node


def _create_course_list(node: Node, data: Dict[str, Any], order_index: int) -> CourseList:
    requirement = data.get("requirement") or {}
    courses = data.get("courses") or []
    course_ids = [course.get("course_id") for course in courses if course.get("course_id")]
    course_category = data.get("course_category")

    filters: Dict[str, Any] = {}
    if course_ids:
        filters["course_id"] = course_ids
    elif course_category and course_category != "任选":
        filters["course_type"] = [course_category]

    course_list = CourseList(
        node_id=node.id,
        name=data.get("name") or "未命名课程组",
        order_index=order_index,
        raw=data.get("raw"),
        remark=data.get("remark"),
        course_category=course_category,
        requirement_raw=requirement.get("raw"),
        requirement_type=requirement.get("type"),
        requirement_min=requirement.get("min"),
        requirement_max=requirement.get("max"),
        source_excel_row=data.get("excel_row"),
        selection_rule={"source": "parsed_xls", "course_count": len(courses)},
        filters=filters,
        max_courses=requirement.get("max") if requirement.get("type") == "courses" else None,
        is_dissertation=_is_dissertation(data.get("name") or ""),
        is_repeatable=False,
        qualification_rules=_legacy_qualification_rules(requirement),
    )
    db.session.add(course_list)
    db.session.flush()
    return course_list


def _create_course_option(program_id: int, course_list_id: int, data: Dict[str, Any], order_index: int) -> ProgramCourseOption:
    option = ProgramCourseOption(
        program_id=program_id,
        course_list_id=course_list_id,
        course_id=data.get("course_id"),
        course_name=data.get("name"),
        credits=data.get("credits"),
        total_hours=data.get("total_hours"),
        practice_total_hours=data.get("practice_total_hours"),
        semester=data.get("semester"),
        source_excel_row=data.get("excel_row"),
        raw_payload=data,
        order_index=order_index,
    )
    db.session.add(option)
    return option


def _create_rules(
    program_id: int,
    owner_type: str,
    owner_id: int,
    rules: Iterable[Dict[str, Any]],
    source_excel_row: Optional[int],
) -> None:
    for index, rule in enumerate(rules):
        parsed = rule.get("parsed") or {}
        db.session.add(
            ProgramRequirementRule(
                program_id=program_id,
                owner_type=owner_type,
                owner_id=owner_id,
                raw=rule.get("raw") or "",
                parsed=parsed,
                target_names=parsed.get("targets") or [],
                metric=parsed.get("metric"),
                operator=parsed.get("operator"),
                value=parsed.get("value"),
                order_index=index,
                source_excel_row=source_excel_row,
            )
        )


def _create_mutual_exclusions(
    program_id: int,
    owner_type: str,
    owner_id: int,
    exclusions: Iterable[Dict[str, Any]],
    source_excel_row: Optional[int],
) -> None:
    for index, exclusion in enumerate(exclusions):
        group = ProgramMutualExclusionGroup(
            program_id=program_id,
            owner_type=owner_type,
            owner_id=owner_id,
            raw=exclusion.get("raw") or "",
            strategy=DEFAULT_MUTUAL_EXCLUSION_STRATEGY,
            order_index=index,
            source_excel_row=source_excel_row,
        )
        db.session.add(group)
        db.session.flush()

        for item_index, course_id in enumerate(exclusion.get("course_ids") or []):
            db.session.add(
                ProgramMutualExclusionItem(
                    group_id=group.id,
                    course_id=course_id,
                    order_index=item_index,
                )
            )


def _legacy_qualification_rules(requirement: Dict[str, Any]) -> list:
    min_value = requirement.get("min")
    if min_value is None:
        return []
    if requirement.get("type") == "credits":
        return [{"min_credits": min_value}]
    if requirement.get("type") == "courses":
        return [{"min_courses": min_value}]
    return []


def _metadata_value(metadata: Dict[str, Any], key: str) -> Any:
    value = metadata.get(key)
    if isinstance(value, dict):
        return value.get("value")
    return value


def _infer_year(text: str) -> Optional[int]:
    match = re.search(r"(20\d{2})", text or "")
    return int(match.group(1)) if match else None


def _is_dissertation(name: str) -> bool:
    return "毕业论文" in name or "毕业设计" in name
