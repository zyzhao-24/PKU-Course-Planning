"""Standalone XLS/XLSX-to-JSON prototype for PKU program plans.

This prototype intentionally does not import the application's parser or models.
It preserves source text, emits typed rule ASTs, resolves named references, and
marks incomplete or ambiguous constructs for review instead of guessing that
they pass.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "pku-program-plan.prototype.v1"
HEADER_MARKERS = ("系列信息", "模块信息", "组信息", "组内课程信息")

COLUMNS = {
    "series_name": 0,
    "series_range": 1,
    "module_name": 2,
    "module_metric": 3,
    "module_range": 4,
    "module_rules": 5,
    "mutual_exclusion": 7,
    "group_name": 9,
    "group_metric": 10,
    "group_range": 11,
    "course_category": 12,
    "course_id": 13,
    "course_name": 14,
    "total_hours": 15,
    "credits": 16,
    "practice_hours": 17,
    "recommended_semester": 18,
}

METADATA_LABELS = {
    "教学计划名称": "plan_name",
    "适用范围": "applicable_scope",
    "教学计划类型": "plan_type",
    "授予学位": "degree",
    "总学分": "declared_total_credits",
    "学分说明": "credit_description",
    "专业简介": "program_intro",
    "培养目标": "objectives",
    "备注": "remark",
    "体系规则": "system_rules",
}

METRICS = {"学分": "credits", "门数": "courses", "学时": "hours"}

SPECIAL_MODULES = {
    "大学英语": {
        "matching_mode": "exclusive",
        "rule_provider": "college_english_policy",
    },
    "体育课": {
        "matching_mode": "exclusive",
        "rule_provider": "physical_education_policy",
    },
    "劳动教育课": {
        "matching_mode": "parallel",
        "rule_provider": "labor_education_policy",
    },
    "思想政治理论选择性必修课": {
        "matching_mode": "parallel",
        "rule_provider": "unresolved",
    },
    "毕业论文": {
        "matching_mode": "exclusive",
        "rule_provider": "dissertation_record",
    },
}


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return str(value).rstrip("0").rstrip(".")
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\xa0", " ").replace("&nbsp;", " ").replace("&nbsp", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line).strip()


def read_workbook(path: Path) -> tuple[list[list[str]], str, str]:
    suffix = path.suffix.lower()
    if suffix == ".xls":
        import xlrd

        workbook = xlrd.open_workbook(path)
        sheet = workbook.sheet_by_index(0)
        rows = [
            [normalize_text(sheet.cell_value(row, col)) for col in range(sheet.ncols)]
            for row in range(sheet.nrows)
        ]
        return rows, sheet.name, f"xlrd {xlrd.__version__}"

    if suffix == ".xlsx":
        import openpyxl

        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        sheet = workbook.worksheets[0]
        rows = [[normalize_text(cell) for cell in row] for row in sheet.iter_rows(values_only=True)]
        return rows, sheet.title, f"openpyxl {openpyxl.__version__}"

    raise ValueError("Only .xls and .xlsx files are supported")


def diagnostic(
    diagnostics: list[dict[str, Any]],
    severity: str,
    code: str,
    message: str,
    *,
    row: int | None = None,
    owner_ref: str | None = None,
    raw: str | None = None,
) -> None:
    item: dict[str, Any] = {"severity": severity, "code": code, "message": message}
    if row is not None:
        item["source_row"] = row
    if owner_ref:
        item["owner_ref"] = owner_ref
    if raw is not None:
        item["raw"] = raw
    diagnostics.append(item)


def parse_number(raw: str) -> int | float | None:
    if not raw:
        return None
    try:
        number = float(raw)
    except ValueError:
        return None
    return int(number) if number.is_integer() else number


def parse_range(raw_value: str, metric_raw: str, origin: dict[str, Any]) -> dict[str, Any]:
    raw = normalize_text(raw_value)
    metric_name = normalize_text(metric_raw)
    metric = METRICS.get(metric_name)
    result: dict[str, Any] = {
        "kind": "range",
        "raw": raw,
        "metric": metric,
        "metric_raw": metric_name,
        "min": None,
        "max": None,
        "status": "parsed",
        "origin": origin,
        "evaluation": {
            "below_min": "failed",
            "within_range": "passed",
            "above_max": "passed_over_range",
        },
    }

    if not raw or raw == "-":
        result["kind"] = "none"
        return result
    if metric is None:
        result["status"] = "unresolved"
        result["error"] = "unknown_metric"

    range_match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)?\s*-\s*(\d+(?:\.\d+)?)?\s*", raw)
    if range_match:
        result["min"] = parse_number(range_match.group(1) or "")
        result["max"] = parse_number(range_match.group(2) or "")
        return result

    exact_match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*", raw)
    if exact_match:
        value = parse_number(exact_match.group(1))
        result["min"] = value
        result["max"] = value
        return result

    result["status"] = "unresolved"
    result["error"] = "invalid_range"
    return result


def split_rule_lines(raw: str) -> list[str]:
    lines = []
    for line in normalize_text(raw).split("\n"):
        value = re.sub(r"^\s*\d+[.、]\s*", "", line).strip()
        if value:
            lines.append(value)
    return lines


def is_rule_heading(line: str) -> bool:
    return bool(re.fullmatch(r"[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+类", line)) or line in {
        "通识核心",
        "课程组",
        "模块",
        "体系规则",
        "课程组要求",
        "通识教育课程要求",
    }


def parse_aggregate_rule(
    raw: str,
    *,
    rule_id: str,
    owner_ref: str,
    row: int,
    section: str | None,
) -> dict[str, Any]:
    pattern = re.compile(
        r"(?P<target_type>模块|课程组)[（(](?P<targets>.*?)[）)]的"
        r"(?P<metric>学分|门数|学时)之和\s*(?P<operator>>=|<=|=|>|<|≥|≤)\s*"
        r"(?P<value>\d+(?:\.\d+)?)"
    )
    match = pattern.search(raw)
    rule: dict[str, Any] = {
        "id": rule_id,
        "kind": "aggregate",
        "raw": raw,
        "section": section,
        "owner_ref": owner_ref,
        "source_row": row,
        "status": "parsed" if match else "unresolved",
        "target_type": None,
        "target_names": [],
        "target_refs": [],
        "metric": None,
        "operator": None,
        "value": None,
    }
    if not match:
        rule["error"] = "unsupported_rule_syntax"
        return rule

    rule.update({
        "target_type": "module" if match.group("target_type") == "模块" else "course_group",
        "target_names": [
            target.strip()
            for target in re.split(r"[,，、]", match.group("targets"))
            if target.strip()
        ],
        "metric": METRICS[match.group("metric")],
        "operator": match.group("operator").replace("≥", ">=").replace("≤", "<="),
        "value": parse_number(match.group("value")),
    })
    return rule


def parse_rule_block(
    raw: str,
    *,
    owner_ref: str,
    row: int,
    id_prefix: str,
) -> list[dict[str, Any]]:
    rules = []
    section = None
    rule_index = 0
    for line in split_rule_lines(raw):
        if is_rule_heading(line):
            section = line
            continue
        rule_index += 1
        rules.append(parse_aggregate_rule(
            line,
            rule_id=f"{id_prefix}-rule-{rule_index:03d}",
            owner_ref=owner_ref,
            row=row,
            section=section,
        ))
    return rules


def parse_mutual_exclusions(
    raw: str,
    *,
    owner_ref: str,
    row: int,
    id_prefix: str,
) -> list[dict[str, Any]]:
    result = []
    for index, line in enumerate(split_rule_lines(raw), start=1):
        course_ids = re.findall(r"(?<![A-Za-z0-9])[A-Za-z]?\d{6,10}(?![A-Za-z0-9])", line)
        result.append({
            "id": f"{id_prefix}-mutual-exclusion-{index:03d}",
            "kind": "mutual_exclusion",
            "raw": line,
            "owner_ref": owner_ref,
            "source_row": row,
            "course_ids": course_ids,
            "max_count": 1,
            "selection_strategy": "unresolved",
            "status": "parsed" if len(course_ids) >= 2 else "unresolved",
        })
    return result


def split_name_and_note(raw_value: str) -> tuple[str, str | None]:
    raw = normalize_text(raw_value)
    match = re.search(r"[（(]\s*备注\s*[:：]\s*(.*?)\s*[）)]\s*$", raw, flags=re.S)
    if not match:
        return raw, None
    return normalize_text(raw[:match.start()]), normalize_text(match.group(1)) or None


def find_header_row(rows: list[list[str]]) -> int:
    for index, row in enumerate(rows):
        joined = "\t".join(row)
        if all(marker in joined for marker in HEADER_MARKERS):
            return index
    raise ValueError("Could not locate the standard program-plan header")


def metadata_values(rows: Iterable[list[str]]) -> dict[str, dict[str, Any]]:
    values: dict[str, dict[str, Any]] = {}
    label_pattern = re.compile(r"^(.+?)[：:]$")
    for row_index, row in enumerate(rows, start=1):
        for col_index, cell in enumerate(row):
            match = label_pattern.match(cell)
            if not match or match.group(1).strip() not in METADATA_LABELS:
                continue
            label = match.group(1).strip()
            value = ""
            for candidate in row[col_index + 1:]:
                if label_pattern.match(candidate):
                    break
                if candidate:
                    value = candidate
                    break
            values[METADATA_LABELS[label]] = {
                "raw": value,
                "value": parse_number(value) if label == "总学分" else (value or None),
                "source_row": row_index,
                "source_label": label,
            }
    return values


def parse_credit_summary(raw: str, row: int | None) -> list[dict[str, Any]]:
    constraints = []
    for line in normalize_text(raw).split("\n"):
        match = re.search(r"(?P<label>[^：:，,]+)[：:]\s*(?P<range>\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?)\s*学分", line)
        if not match:
            continue
        constraints.append({
            "label": match.group("label").replace("其中", "").strip(" ：:，,"),
            "constraint": parse_range(
                match.group("range"),
                "学分",
                {"section": "metadata.credit_description", "source_row": row},
            ),
            "raw": line,
            "target_ref": None,
            "status": "parsed",
        })
    return constraints


def build_course(row: list[str], source_row: int, course_index: int) -> dict[str, Any]:
    def value(key: str) -> str:
        index = COLUMNS[key]
        return row[index] if index < len(row) else ""

    return {
        "id": f"course-option-{course_index:04d}",
        "course_id": value("course_id") or None,
        "course_name": value("course_name") or None,
        "course_category": value("course_category") or None,
        "credits": parse_number(value("credits")),
        "total_hours": parse_number(value("total_hours")),
        "practice_hours": parse_number(value("practice_hours")),
        "recommended_semester": value("recommended_semester") or None,
        "source_row": source_row,
        "raw": {
            "course_id": value("course_id"),
            "course_name": value("course_name"),
            "course_category": value("course_category"),
            "credits": value("credits"),
            "total_hours": value("total_hours"),
            "practice_hours": value("practice_hours"),
            "recommended_semester": value("recommended_semester"),
        },
    }


def has_course(row: list[str]) -> bool:
    return any(
        COLUMNS[key] < len(row) and row[COLUMNS[key]]
        for key in ("course_id", "course_name")
    )


def describe_membership(module: dict[str, Any], group: dict[str, Any]) -> dict[str, Any]:
    course_ids = [course["course_id"] for course in group["course_options"] if course["course_id"]]
    special = SPECIAL_MODULES.get(module["name"])
    if course_ids:
        return {
            "mode": "explicit_course_ids",
            "status": "resolved",
            "course_ids": course_ids,
            "course_category_hint": group["course_category"],
        }
    if special and special["rule_provider"] != "unresolved":
        return {
            "mode": "external_policy",
            "status": "resolved_external",
            "provider": special["rule_provider"],
            "course_ids": [],
            "course_category_hint": group["course_category"],
        }
    if group["course_category"]:
        return {
            "mode": "course_category_hint",
            "status": "needs_review",
            "course_ids": [],
            "course_category_hint": group["course_category"],
        }
    return {
        "mode": "unresolved",
        "status": "unresolved",
        "course_ids": [],
        "course_category_hint": None,
    }


def parse_document(input_path: Path) -> dict[str, Any]:
    rows, sheet_name, reader = read_workbook(input_path)
    diagnostics: list[dict[str, Any]] = []
    header_index = find_header_row(rows)
    metadata = metadata_values(rows[:header_index])

    document: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "document_status": "draft",
        "source": {
            "filename": input_path.name,
            "sheet_name": sheet_name,
            "rows": len(rows),
            "columns": max((len(row) for row in rows), default=0),
            "reader": reader,
            "header_row": header_index + 1,
        },
        "metadata": metadata,
        "plan_constraints": [],
        "system_rules": [],
        "series": [],
        "diagnostics": diagnostics,
    }

    declared = metadata.get("declared_total_credits")
    if declared and declared["raw"]:
        document["plan_constraints"].append(parse_range(
            declared["raw"],
            "学分",
            {"section": "metadata.declared_total_credits", "source_row": declared["source_row"]},
        ))

    credit_description = metadata.get("credit_description") or {}
    document["credit_summary_constraints"] = parse_credit_summary(
        credit_description.get("raw", ""),
        credit_description.get("source_row"),
    )

    system_rules = metadata.get("system_rules") or {}
    document["system_rules"] = parse_rule_block(
        system_rules.get("raw", ""),
        owner_ref="program",
        row=system_rules.get("source_row") or 0,
        id_prefix="program",
    )

    current_series = None
    current_module = None
    current_group = None
    series_count = module_count = group_count = course_count = 0

    for row_index in range(header_index + 2, len(rows)):
        source_row = row_index + 1
        row = rows[row_index] + [""] * max(0, 19 - len(rows[row_index]))
        if not any(row[index] for index in COLUMNS.values()):
            continue

        if row[COLUMNS["series_name"]]:
            series_count += 1
            name, note = split_name_and_note(row[COLUMNS["series_name"]])
            current_series = {
                "id": f"series-{series_count:03d}",
                "name": name,
                "raw_name": row[COLUMNS["series_name"]],
                "note": note,
                "constraint": parse_range(
                    row[COLUMNS["series_range"]],
                    "学分",
                    {"section": "series", "source_row": source_row},
                ),
                "matching_mode": "exclusive",
                "source_row": source_row,
                "modules": [],
            }
            document["series"].append(current_series)
            current_module = None
            current_group = None

        if row[COLUMNS["module_name"]]:
            if current_series is None:
                diagnostic(diagnostics, "fatal", "module_without_series", "模块没有所属系列", row=source_row)
                continue
            module_count += 1
            name, note = split_name_and_note(row[COLUMNS["module_name"]])
            module_id = f"module-{module_count:03d}"
            special = SPECIAL_MODULES.get(name, {})
            current_module = {
                "id": module_id,
                "series_ref": current_series["id"],
                "name": name,
                "raw_name": row[COLUMNS["module_name"]],
                "note": note,
                "constraint": parse_range(
                    row[COLUMNS["module_range"]],
                    row[COLUMNS["module_metric"]],
                    {"section": "module", "source_row": source_row},
                ),
                "execution": {
                    "matching_mode": special.get("matching_mode", "exclusive"),
                    "rule_provider": special.get("rule_provider", "xls"),
                    "source": "domain_hint" if special else "xls_default",
                },
                "aggregate_rules": parse_rule_block(
                    row[COLUMNS["module_rules"]],
                    owner_ref=module_id,
                    row=source_row,
                    id_prefix=module_id,
                ),
                "mutual_exclusions": parse_mutual_exclusions(
                    row[COLUMNS["mutual_exclusion"]],
                    owner_ref=module_id,
                    row=source_row,
                    id_prefix=module_id,
                ),
                "source_row": source_row,
                "groups": [],
            }
            current_series["modules"].append(current_module)
            current_group = None

        if row[COLUMNS["group_name"]]:
            if current_module is None:
                diagnostic(diagnostics, "fatal", "group_without_module", "课程组没有所属模块", row=source_row)
                continue
            group_count += 1
            name, note = split_name_and_note(row[COLUMNS["group_name"]])
            current_group = {
                "id": f"course-group-{group_count:03d}",
                "module_ref": current_module["id"],
                "name": name,
                "raw_name": row[COLUMNS["group_name"]],
                "note": note,
                "constraint": parse_range(
                    row[COLUMNS["group_range"]],
                    row[COLUMNS["group_metric"]],
                    {"section": "course_group", "source_row": source_row},
                ),
                "course_category": row[COLUMNS["course_category"]] or None,
                "source_row": source_row,
                "membership": None,
                "course_options": [],
            }
            current_module["groups"].append(current_group)

        if has_course(row):
            if current_group is None:
                diagnostic(
                    diagnostics,
                    "error",
                    "course_without_group",
                    "课程行没有所属课程组，未自动创建宽泛课程组",
                    row=source_row,
                    owner_ref=current_module["id"] if current_module else None,
                )
                continue
            course_count += 1
            current_group["course_options"].append(build_course(row, source_row, course_count))

    resolve_and_validate(document)
    document["summary"] = build_summary(document)
    severities = {item["severity"] for item in diagnostics}
    if "fatal" in severities:
        document["document_status"] = "invalid"
    elif "error" in severities or "warning" in severities:
        document["document_status"] = "needs_review"
    else:
        document["document_status"] = "executable"
    return document


def resolve_and_validate(document: dict[str, Any]) -> None:
    diagnostics = document["diagnostics"]
    modules = [module for series in document["series"] for module in series["modules"]]
    groups = [group for module in modules for group in module["groups"]]
    modules_by_name: dict[str, list[dict[str, Any]]] = {}
    groups_by_module_and_name: dict[tuple[str, str], list[dict[str, Any]]] = {}

    for module in modules:
        modules_by_name.setdefault(module["name"], []).append(module)
        for group in module["groups"]:
            groups_by_module_and_name.setdefault((module["id"], group["name"]), []).append(group)
            group["membership"] = describe_membership(module, group)
            if group["membership"]["status"] == "needs_review":
                diagnostic(
                    diagnostics,
                    "warning",
                    "course_category_is_hint_only",
                    "课程组没有明确课号，课程类别只能作为提示，不能直接视为完整成员规则",
                    row=group["source_row"],
                    owner_ref=group["id"],
                    raw=group["course_category"],
                )
            elif group["membership"]["status"] == "unresolved":
                diagnostic(
                    diagnostics,
                    "error",
                    "unresolved_group_membership",
                    "课程组没有候选课程或可用的外部规则来源",
                    row=group["source_row"],
                    owner_ref=group["id"],
                )

    for module in modules:
        if not module["groups"] and module["execution"]["rule_provider"] in {"xls", "unresolved"}:
            diagnostic(
                diagnostics,
                "error",
                "module_without_groups",
                "模块没有课程组，且没有已解析的外部规则来源",
                row=module["source_row"],
                owner_ref=module["id"],
            )

        membership_signatures: dict[str, list[str]] = {}
        for group in module["groups"]:
            membership = group["membership"]
            if membership["mode"] == "course_category_hint":
                signature = membership.get("course_category_hint") or ""
                membership_signatures.setdefault(signature, []).append(group["id"])
        for signature, group_refs in membership_signatures.items():
            if len(group_refs) > 1:
                diagnostic(
                    diagnostics,
                    "error",
                    "ambiguous_duplicate_membership_hint",
                    "同一模块内多个课程组只有相同课程类别提示，无法据此区分归属",
                    row=module["source_row"],
                    owner_ref=module["id"],
                    raw=signature,
                )

    all_rules = list(document["system_rules"])
    for module in modules:
        all_rules.extend(module["aggregate_rules"])
        for exclusion in module["mutual_exclusions"]:
            if exclusion["status"] != "parsed":
                diagnostic(
                    diagnostics,
                    "error",
                    "unresolved_mutual_exclusion",
                    "互斥规则至少需要两个可识别课号",
                    row=exclusion["source_row"],
                    owner_ref=module["id"],
                    raw=exclusion["raw"],
                )

    module_by_id = {module["id"]: module for module in modules}
    for rule in all_rules:
        if rule["status"] != "parsed":
            diagnostic(
                diagnostics,
                "error",
                "unresolved_rule_syntax",
                "规则原文无法转换为可执行结构",
                row=rule["source_row"],
                owner_ref=rule["owner_ref"],
                raw=rule["raw"],
            )
            continue

        resolved = []
        for target_name in rule["target_names"]:
            if rule["target_type"] == "module":
                candidates = modules_by_name.get(target_name, [])
            else:
                owner_module = module_by_id.get(rule["owner_ref"])
                candidates = groups_by_module_and_name.get((owner_module["id"], target_name), []) if owner_module else []
            if len(candidates) == 1:
                resolved.append(candidates[0]["id"])
            else:
                rule["status"] = "unresolved"
                rule.setdefault("resolution_errors", []).append({
                    "target_name": target_name,
                    "matches": [candidate["id"] for candidate in candidates],
                })
        rule["target_refs"] = resolved
        if rule["status"] == "unresolved":
            diagnostic(
                diagnostics,
                "error",
                "unresolved_rule_reference",
                "规则目标名称缺失或不唯一",
                row=rule["source_row"],
                owner_ref=rule["owner_ref"],
                raw=rule["raw"],
            )

    for item in document["credit_summary_constraints"]:
        label = item["label"]
        if label == "毕业总学分":
            item["target_ref"] = "program"
        else:
            series_matches = [series for series in document["series"] if series["name"] == label]
            if len(series_matches) == 1:
                item["target_ref"] = series_matches[0]["id"]
            else:
                item["status"] = "unresolved"
                diagnostic(
                    diagnostics,
                    "warning",
                    "unresolved_credit_summary_label",
                    "学分说明中的名称无法唯一对应系列，仅保留原文",
                    row=item["constraint"]["origin"].get("source_row"),
                    raw=item["raw"],
                )


def build_summary(document: dict[str, Any]) -> dict[str, Any]:
    modules = [module for series in document["series"] for module in series["modules"]]
    groups = [group for module in modules for group in module["groups"]]
    courses = [course for group in groups for course in group["course_options"]]
    rules = list(document["system_rules"]) + [
        rule for module in modules for rule in module["aggregate_rules"]
    ]
    exclusions = [item for module in modules for item in module["mutual_exclusions"]]
    severity_counts = {
        severity: sum(1 for item in document["diagnostics"] if item["severity"] == severity)
        for severity in ("fatal", "error", "warning", "info")
    }
    return {
        "series": len(document["series"]),
        "modules": len(modules),
        "course_groups": len(groups),
        "course_options": len(courses),
        "aggregate_rules": len(rules),
        "parsed_aggregate_rules": sum(1 for rule in rules if rule["status"] == "parsed"),
        "mutual_exclusions": len(exclusions),
        "resolved_memberships": sum(
            1 for group in groups if group["membership"]["status"].startswith("resolved")
        ),
        "memberships_needing_review": sum(
            1 for group in groups if group["membership"]["status"] in {"needs_review", "unresolved"}
        ),
        "diagnostics": severity_counts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse a PKU program-plan XLS/XLSX into prototype JSON")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    document = parse_document(args.input.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output.resolve()),
        "document_status": document["document_status"],
        "summary": document["summary"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
