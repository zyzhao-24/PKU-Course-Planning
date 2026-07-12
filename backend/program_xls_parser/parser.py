"""Parse PKU training-program XLS files into structured JSON-ready dicts."""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional, Tuple


HEADER_MARKERS = ("系列信息", "模块信息", "组信息", "组内课程信息")


COLUMN_INDEX = {
    "category_name": 0,
    "category_requirement": 1,
    "module_name": 2,
    "module_constraint_type": 3,
    "module_constraint_range": 4,
    "module_constraint_description": 5,
    "mutual_exclusion": 7,
    "group_name": 9,
    "group_constraint_type": 10,
    "group_constraint_range": 11,
    "course_category": 12,
    "course_id": 13,
    "course_name": 14,
    "total_hours": 15,
    "credits": 16,
    "practice_total_hours": 17,
    "semester": 18,
}


METADATA_KEYS = {
    "教学计划名称": "plan_name",
    "适用范围": "applicable_scope",
    "教学计划类型": "plan_type",
    "授予学位": "degree",
    "总学分": "total_credits",
    "学分说明": "credit_description",
    "专业简介": "program_intro",
    "培养目标": "objectives",
    "备注": "remark",
    "体系规则": "system_rules",
}


REQUIREMENT_TYPES = {
    "学分": "credits",
    "门数": "courses",
    "学时": "hours",
}


RULE_METRICS = {
    "学分": "credits",
    "门数": "courses",
    "学时": "hours",
}


def parse_xls(file_path: str) -> Dict[str, Any]:
    """Parse a PKU program-plan .xls file into a structured dictionary."""
    rows, sheet_name = read_xls(file_path)
    warnings: List[Dict[str, str]] = []
    header_row = find_header_row(rows)
    metadata = parse_metadata(rows[:header_row], warnings)
    categories = parse_program_table(rows[header_row + 2 :], warnings, start_excel_row=header_row + 3)

    return {
        "source": {
            "filename": os.path.basename(file_path),
            "sheet_name": sheet_name,
            "rows": len(rows),
            "cols": max((len(row) for row in rows), default=0),
        },
        "metadata": metadata,
        "categories": categories,
        "warnings": warnings,
    }


def read_xls(file_path: str) -> Tuple[List[List[str]], str]:
    try:
        import xlrd
    except ImportError as exc:
        raise RuntimeError(
            "xlrd==2.0.1 is required to parse .xls files. "
            "Install backend dependencies with: pip install -r backend/requirements.txt"
        ) from exc

    workbook = xlrd.open_workbook(file_path)
    sheet = workbook.sheet_by_index(0)
    rows: List[List[str]] = []
    for row_idx in range(sheet.nrows):
        row = [normalize_cell(sheet.cell_value(row_idx, col_idx)) for col_idx in range(sheet.ncols)]
        rows.append(row)
    return rows, sheet.name


def normalize_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return str(value).rstrip("0").rstrip(".")
    return normalize_text(str(value))


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\xa0", " ").replace("&nbsp", " ").replace("&nbsp;", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line).strip()


def find_header_row(rows: List[List[str]]) -> int:
    for idx, row in enumerate(rows):
        joined = "\t".join(row)
        if all(marker in joined for marker in HEADER_MARKERS):
            return idx
    raise ValueError("Could not locate standard program table header.")


def parse_metadata(rows: List[List[str]], warnings: List[Dict[str, str]]) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {}

    title = first_non_empty(rows[0]) if rows else ""
    if title:
        metadata["title"] = value_with_optional_raw(title, title)

    raw_values = extract_metadata_values(rows)
    for source_key, output_key in METADATA_KEYS.items():
        raw = raw_values.get(source_key, "")
        if output_key == "total_credits":
            total_raw = raw or raw_values.get("学分说明", "")
            metadata[output_key] = parse_total_credits(total_raw)
        elif output_key == "system_rules":
            metadata[output_key] = parse_rules(raw, warnings, "metadata.system_rules") if raw else []
        else:
            metadata[output_key] = value_with_optional_raw(raw, raw) if raw else {"raw": "", "value": None}

    if "total_credits" not in metadata:
        metadata["total_credits"] = {"raw": "", "value": None}
    if "system_rules" not in metadata:
        metadata["system_rules"] = []

    return metadata


def extract_metadata_values(rows: List[List[str]]) -> Dict[str, str]:
    values: Dict[str, str] = {}
    key_pattern = re.compile(r"^(.+?)[：:]$")

    for row in rows:
        for idx, cell in enumerate(row):
            match = key_pattern.match(cell)
            if not match:
                continue
            key = match.group(1).strip()
            if key not in METADATA_KEYS:
                continue
            values[key] = find_value_to_right(row, idx + 1, key_pattern)

    return values


def find_value_to_right(row: List[str], start: int, key_pattern: re.Pattern[str]) -> str:
    for cell in row[start:]:
        if key_pattern.match(cell):
            return ""
        if cell:
            return cell
    return ""


def parse_program_table(
    rows: List[List[str]], warnings: List[Dict[str, str]], start_excel_row: int
) -> List[Dict[str, Any]]:
    categories: List[Dict[str, Any]] = []
    current_category: Optional[Dict[str, Any]] = None
    current_module: Optional[Dict[str, Any]] = None
    current_group: Optional[Dict[str, Any]] = None

    for offset, row in enumerate(rows):
        excel_row = start_excel_row + offset
        row = pad_row(row, 19)
        if is_empty_data_row(row):
            continue

        category_text = row[COLUMN_INDEX["category_name"]]
        module_text = row[COLUMN_INDEX["module_name"]]
        group_text = row[COLUMN_INDEX["group_name"]]

        if category_text:
            current_category = build_category(row, excel_row)
            categories.append(current_category)
            current_module = None
            current_group = None

        if module_text:
            if current_category is None:
                current_category = build_placeholder_category(categories, warnings, excel_row)
            current_module = build_module(row, warnings, excel_row)
            current_category["modules"].append(current_module)
            current_group = None

        if group_text:
            if current_module is None:
                current_module = build_placeholder_module(current_category, categories, warnings, excel_row)
            current_group = build_group(row, excel_row)
            current_module["groups"].append(current_group)

        if has_course(row):
            if current_module is None:
                current_module = build_placeholder_module(current_category, categories, warnings, excel_row)
            if current_group is None:
                current_group = build_default_group(current_module, row, excel_row)
                current_module["groups"].append(current_group)
            current_group["courses"].append(build_course(row, excel_row))

    return categories


def build_category(row: List[str], excel_row: int) -> Dict[str, Any]:
    name_info = split_name_and_remark(row[COLUMN_INDEX["category_name"]])
    return {
        "raw": name_info["raw"],
        "name": name_info["name"],
        "requirement": parse_requirement("学分", row[COLUMN_INDEX["category_requirement"]]),
        "remark": name_info["remark"],
        "excel_row": excel_row,
        "modules": [],
    }


def build_module(row: List[str], warnings: List[Dict[str, str]], excel_row: int) -> Dict[str, Any]:
    name_info = split_name_and_remark(row[COLUMN_INDEX["module_name"]])
    description = row[COLUMN_INDEX["module_constraint_description"]]
    mutual_exclusion_raw = row[COLUMN_INDEX["mutual_exclusion"]]
    return {
        "raw": name_info["raw"],
        "name": name_info["name"],
        "requirement": parse_requirement(
            row[COLUMN_INDEX["module_constraint_type"]],
            row[COLUMN_INDEX["module_constraint_range"]],
        ),
        "remark": name_info["remark"],
        "rules": parse_rules(description, warnings, f"row {excel_row} module rules") if description else [],
        "mutual_exclusion": parse_mutual_exclusion(mutual_exclusion_raw, warnings, f"row {excel_row} mutual exclusion")
        if mutual_exclusion_raw
        else [],
        "excel_row": excel_row,
        "groups": [],
    }


def build_group(row: List[str], excel_row: int) -> Dict[str, Any]:
    name_info = split_name_and_remark(row[COLUMN_INDEX["group_name"]])
    return {
        "raw": name_info["raw"],
        "name": name_info["name"],
        "requirement": parse_requirement(
            row[COLUMN_INDEX["group_constraint_type"]],
            row[COLUMN_INDEX["group_constraint_range"]],
        ),
        "remark": name_info["remark"],
        "course_category": row[COLUMN_INDEX["course_category"]] or None,
        "excel_row": excel_row,
        "courses": [],
    }


def build_course(row: List[str], excel_row: int) -> Dict[str, Any]:
    return {
        "course_id": row[COLUMN_INDEX["course_id"]] or None,
        "name": row[COLUMN_INDEX["course_name"]] or None,
        "total_hours": parse_number(row[COLUMN_INDEX["total_hours"]]),
        "credits": parse_number(row[COLUMN_INDEX["credits"]]),
        "practice_total_hours": parse_number(row[COLUMN_INDEX["practice_total_hours"]]),
        "semester": row[COLUMN_INDEX["semester"]] or None,
        "excel_row": excel_row,
    }


def build_default_group(module: Dict[str, Any], row: List[str], excel_row: int) -> Dict[str, Any]:
    name = row[COLUMN_INDEX["course_category"]] or module["name"] or "未分组课程"
    return {
        "raw": name,
        "name": name,
        "requirement": parse_requirement("", ""),
        "remark": None,
        "course_category": row[COLUMN_INDEX["course_category"]] or None,
        "excel_row": excel_row,
        "courses": [],
    }


def build_placeholder_category(
    categories: List[Dict[str, Any]], warnings: List[Dict[str, str]], excel_row: int
) -> Dict[str, Any]:
    category = {
        "raw": "未分类",
        "name": "未分类",
        "requirement": parse_requirement("学分", ""),
        "remark": None,
        "excel_row": excel_row,
        "modules": [],
    }
    categories.append(category)
    warnings.append({"location": f"row {excel_row}", "message": "Found module before category; created placeholder category."})
    return category


def build_placeholder_module(
    current_category: Optional[Dict[str, Any]],
    categories: List[Dict[str, Any]],
    warnings: List[Dict[str, str]],
    excel_row: int,
) -> Dict[str, Any]:
    if current_category is None:
        current_category = build_placeholder_category(categories, warnings, excel_row)
    module = {
        "raw": "未分组模块",
        "name": "未分组模块",
        "requirement": parse_requirement("", ""),
        "remark": None,
        "rules": [],
        "mutual_exclusion": [],
        "excel_row": excel_row,
        "groups": [],
    }
    current_category["modules"].append(module)
    warnings.append({"location": f"row {excel_row}", "message": "Found group/course before module; created placeholder module."})
    return module


def split_name_and_remark(text: str) -> Dict[str, Any]:
    raw = normalize_text(text)
    if not raw:
        return {"raw": "", "name": "", "remark": None}

    remark_match = re.search(r"[（(]\s*备注\s*[:：]\s*(.*?)\s*[）)]\s*$", raw, flags=re.S)
    if not remark_match:
        return {"raw": raw, "name": raw, "remark": None}

    remark_raw = remark_match.group(0)
    remark_value = normalize_text(remark_match.group(1))
    name = normalize_text(raw[: remark_match.start()])
    return {
        "raw": raw,
        "name": name,
        "remark": value_with_optional_raw(remark_raw, remark_value),
    }


def value_with_optional_raw(raw: str, value: Any) -> Dict[str, Any]:
    if raw == value:
        return {"value": value}
    return {"raw": raw, "value": value}


def parse_requirement(requirement_type_raw: str, requirement_range_raw: str) -> Dict[str, Any]:
    raw = normalize_text(requirement_range_raw)
    requirement_type = REQUIREMENT_TYPES.get(normalize_text(requirement_type_raw))
    result: Dict[str, Any] = {
        "raw": raw,
        "type": requirement_type,
        "min": None,
        "max": None,
    }

    if not raw or raw == "-":
        return result

    range_match = re.match(r"^\s*(\d+(?:\.\d+)?)?\s*-\s*(\d+(?:\.\d+)?)?\s*$", raw)
    if range_match:
        result["min"] = parse_numeric_token(range_match.group(1))
        result["max"] = parse_numeric_token(range_match.group(2))
        return result

    single_match = re.match(r"^\s*(\d+(?:\.\d+)?)\s*$", raw)
    if single_match:
        value = parse_numeric_token(single_match.group(1))
        result["min"] = value
        result["max"] = value
        return result

    return result


def parse_total_credits(raw: str) -> Dict[str, Any]:
    raw = normalize_text(raw)
    result = {"raw": raw, "value": None}
    if not raw:
        return result

    patterns = [
        r"^\s*(\d+(?:\.\d+)?)\s*$",
        r"总学分\s*(\d+(?:\.\d+)?)\s*分",
        r"总学分\s*(\d+(?:\.\d+)?)\s*学分",
        r"修满[^\d]{0,20}(\d+(?:\.\d+)?)\s*学分",
        r"培养方案规定的\s*(\d+(?:\.\d+)?)\s*学分",
    ]
    for pattern in patterns:
        match = re.search(pattern, raw)
        if match:
            result["value"] = parse_numeric_token(match.group(1))
            break
    return result


def parse_rules(raw: str, warnings: List[Dict[str, str]], location: str) -> List[Dict[str, Any]]:
    text = normalize_text(raw)
    if not text:
        return []

    rules = []
    for line in split_rule_lines(text):
        if is_rule_heading(line):
            continue
        parsed = parse_rule_line(line)
        rule = {"raw": line, "parsed": parsed}
        rules.append(rule)
        if parsed is None:
            warnings.append({"location": location, "message": f"Could not structure rule: {line}"})
    return rules


def is_rule_heading(line: str) -> bool:
    return line in {"课程组", "模块", "通识教育课程要求", "课程组要求", "体系规则"}


def split_rule_lines(text: str) -> List[str]:
    lines: List[str] = []
    for line in text.split("\n"):
        clean = normalize_text(re.sub(r"^\s*\d+[.、]\s*", "", line))
        if clean:
            lines.append(clean)
    return lines


def parse_rule_line(line: str) -> Optional[Dict[str, Any]]:
    pattern = re.compile(
        r"(?P<subject>模块|课程组)[（(](?P<targets>.*?)[）)]的(?P<metric>学分|门数|学时)之和\s*"
        r"(?P<operator>>=|<=|=|>|<|≥|≤)\s*(?P<value>\d+(?:\.\d+)?)"
    )
    match = pattern.search(line)
    if not match:
        return None

    operator = match.group("operator").replace("≥", ">=").replace("≤", "<=")
    targets = [part.strip() for part in re.split(r"[,，、]", match.group("targets")) if part.strip()]
    return {
        "subject": match.group("subject"),
        "targets": targets,
        "metric": RULE_METRICS[match.group("metric")],
        "operator": operator,
        "value": parse_numeric_token(match.group("value")),
    }


def parse_mutual_exclusion(
    raw: str, warnings: List[Dict[str, str]], location: str
) -> List[Dict[str, Any]]:
    text = normalize_text(raw)
    if not text:
        return []

    exclusions = []
    for line in [line for line in text.split("\n") if line.strip()]:
        course_ids = re.findall(r"[A-Za-z0-9]{6,}", line)
        item = {"raw": line, "course_ids": course_ids}
        exclusions.append(item)
        if len(course_ids) < 2:
            warnings.append({"location": location, "message": f"Could not parse mutual exclusion pair: {line}"})
    return exclusions


def parse_number(raw: str) -> Optional[float]:
    raw = normalize_text(raw)
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return int(value) if value.is_integer() else value


def parse_numeric_token(token: Optional[str]) -> Optional[float]:
    if token is None or token == "":
        return None
    value = float(token)
    return int(value) if value.is_integer() else value


def first_non_empty(row: List[str]) -> str:
    for cell in row:
        if cell:
            return cell
    return ""


def pad_row(row: List[str], size: int) -> List[str]:
    return row + [""] * max(0, size - len(row))


def is_empty_data_row(row: List[str]) -> bool:
    relevant = [row[idx] for idx in COLUMN_INDEX.values()]
    return not any(relevant)


def has_course(row: List[str]) -> bool:
    return bool(row[COLUMN_INDEX["course_id"]] or row[COLUMN_INDEX["course_name"]])
