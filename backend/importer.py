"""Import semester course catalogs from the normalized JSON format."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Iterable, Tuple

from database import db
from models import Course, CourseNameMapping, Semester
from semester_utils import (
    build_semester_name,
    parse_first_week_monday,
    parse_semester_name,
    validate_academic_year,
)


IMPORT_MODES = {"append", "overwrite"}


def migrate_class_times_format(class_times, week_range=None):
    """Move a legacy course-level week range into each class-time item."""
    if not class_times or not isinstance(class_times, list):
        return []

    migrated = []
    for item in class_times:
        if not isinstance(item, dict):
            raise ValueError("class_times 中的每一项都必须是对象")
        normalized = dict(item)
        if not normalized.get("week_range") and week_range:
            normalized["week_range"] = week_range
        migrated.append(normalized)
    return migrated


def _normalize_course(data: Dict[str, Any]) -> Dict[str, Any]:
    course_id = str(data.get("course_id") or "").strip()
    course_name = str(data.get("course_name") or "").strip()
    class_number = str(data.get("class_number") or "").strip()
    if not course_id or not course_name or not class_number:
        raise ValueError("每门课程必须提供 course_id、course_name 和 class_number")

    try:
        credits = float(data.get("credits"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"课程 {course_id}-{class_number} 的 credits 必须是数字") from exc

    teachers = data.get("teachers") or []
    if not isinstance(teachers, list):
        raise ValueError(f"课程 {course_id}-{class_number} 的 teachers 必须是数组")

    return {
        "source_uuid": str(data.get("uuid") or "").strip() or None,
        "course_id": course_id,
        "course_name": course_name,
        "course_type": str(data.get("course_type") or "").strip(),
        "department_code": str(data.get("department_code") or "0").strip() or "0",
        "class_number": class_number,
        "credits": credits,
        "class_times": migrate_class_times_format(
            data.get("class_times", []),
            data.get("week_range"),
        ),
        "teachers": [str(teacher).strip() for teacher in teachers if str(teacher).strip()],
        "remarks": str(data.get("remarks") or "").strip(),
    }


def _course_identity(course: Dict[str, Any]) -> Tuple[str, str]:
    return course["course_id"], course["class_number"]


def _stable_tail(seed: str, digits: int, salt: int = 0) -> str:
    digest = hashlib.sha256(f"{seed}|{salt}".encode("utf-8")).digest()
    return f"{int.from_bytes(digest[:8], 'big') % (10 ** digits):0{digits}d}"


def _generate_bz_uuid(
    semester_name: str,
    course_id: str,
    class_number: str,
    occupied: set[str],
) -> str:
    semester_token = semester_name.replace("-", "")
    class_token = class_number.rjust(2, "_")
    seed = f"{semester_name}|{course_id}|{class_number}"
    for salt in range(10000):
        candidate = f"BZ{semester_token}{course_id}{class_token}{_stable_tail(seed, 4, salt)}"
        if candidate not in occupied:
            return candidate
    raise ValueError(f"无法为课程 {course_id}-{class_number} 生成唯一 UUID")


def _next_cz_uuid(
    academic_year: str,
    course_id: str,
    occupied: set[str],
) -> str:
    prefix = f"CZ{academic_year.replace('-', '')}{course_id}"
    serials = []
    for uuid in occupied:
        if uuid.startswith(prefix):
            suffix = uuid[len(prefix):]
            if len(suffix) == 6 and suffix.isdigit():
                serials.append(int(suffix))
    serial = max(serials, default=0) + 1
    while serial <= 999999:
        candidate = f"{prefix}{serial:06d}"
        if candidate not in occupied:
            return candidate
        serial += 1
    raise ValueError(f"无法为长周期课程 {course_id} 生成唯一 UUID")


def _generated_uuid(
    course: Dict[str, Any],
    semester_name: str,
    academic_year: str,
    occupied: set[str],
) -> str:
    if (course.get("source_uuid") or "").startswith("CZ"):
        return _next_cz_uuid(academic_year, course["course_id"], occupied)
    return _generate_bz_uuid(
        semester_name,
        course["course_id"],
        course["class_number"],
        occupied,
    )


def _validate_course_master_data(courses: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    master_data: Dict[str, Dict[str, Any]] = {}
    for course in courses:
        value = {
            "course_name": course["course_name"],
            "credits": course["credits"],
        }
        previous = master_data.get(course["course_id"])
        if previous and previous != value:
            raise ValueError(
                f"同一课号 {course['course_id']} 在 JSON 中存在不同的课程名称或学分"
            )
        master_data[course["course_id"]] = value
    return master_data


def _upsert_course_master_data(master_data: Dict[str, Dict[str, Any]]) -> None:
    for course_id, value in master_data.items():
        mapping = db.session.get(CourseNameMapping, course_id)
        if not mapping:
            mapping = CourseNameMapping(course_id=course_id)
            db.session.add(mapping)
        mapping.course_name = value["course_name"]
        mapping.credits = value["credits"]


def _set_course_fields(course: Course, data: Dict[str, Any], semester_name: str) -> None:
    course.course_id = data["course_id"]
    course.course_type = data["course_type"]
    course.department_code = data["department_code"]
    course.class_number = data["class_number"]
    course.semester = semester_name
    course.class_times = data["class_times"]
    course.teachers = data["teachers"]
    course.remarks = data["remarks"]


def _resolve_semester(
    source_semester_name: str,
    target_academic_year: str | None,
    first_week_monday: str | None,
) -> Tuple[Semester, bool, bool]:
    source_year, source_term = parse_semester_name(source_semester_name)
    target_year = (
        validate_academic_year(target_academic_year)
        if target_academic_year
        else source_year
    )
    target_name = build_semester_name(target_year, source_term)
    semester = Semester.query.filter_by(name=target_name).first()
    created = False
    if not semester:
        semester = Semester(
            name=target_name,
            academic_year=target_year,
            term=source_term,
            first_week_monday=parse_first_week_monday(
                first_week_monday,
                required=True,
            ),
        )
        db.session.add(semester)
        db.session.flush()
        created = True
    return semester, created, target_name == source_semester_name


def import_courses_from_json(
    file_path,
    *,
    target_academic_year: str | None = None,
    first_week_monday: str | None = None,
    import_mode: str = "append",
):
    """Import one JSON course catalog in a single database transaction."""
    try:
        mode = str(import_mode or "append").strip().lower()
        if mode not in IMPORT_MODES:
            raise ValueError("导入方式只能是 append 或 overwrite")

        data = json.loads(Path(file_path).read_text(encoding="utf-8"))
        metadata = data.get("metadata")
        raw_courses = data.get("courses")
        if not isinstance(metadata, dict) or not isinstance(raw_courses, list):
            raise ValueError("JSON 必须包含 metadata 对象和 courses 数组")
        if metadata.get("format_version") not in (None, "1.0"):
            raise ValueError("不支持的课程 JSON 格式版本")

        source_semester_name = str(metadata.get("yearandseme") or "").strip()
        parse_semester_name(source_semester_name)
        semester, semester_created, imports_source_semester = _resolve_semester(
            source_semester_name,
            target_academic_year,
            first_week_monday,
        )

        courses = [_normalize_course(item) for item in raw_courses]
        identities = [_course_identity(course) for course in courses]
        if len(identities) != len(set(identities)):
            raise ValueError("JSON 中存在重复的课号-班号组合")

        master_data = _validate_course_master_data(courses)
        _upsert_course_master_data(master_data)

        existing_courses = Course.query.filter_by(semester=semester.name).all()
        existing_by_identity: Dict[Tuple[str, str], list[Course]] = {}
        for existing in existing_courses:
            identity = (existing.course_id, str(existing.class_number or ""))
            existing_by_identity.setdefault(identity, []).append(existing)

        occupied = {row.uuid for row in Course.query.with_entities(Course.uuid).all()}
        imported_identities = set(identities)
        retained_uuids: set[str] = set()
        replaced_uuids: set[str] = set()
        added = 0
        updated = 0
        uuid_changed = 0

        for course_data in courses:
            identity = _course_identity(course_data)
            matches = existing_by_identity.get(identity, [])
            existing = matches[0] if matches else None
            matched_existing = existing is not None

            if existing and (not imports_source_semester or not course_data["source_uuid"]):
                desired_uuid = existing.uuid
            elif imports_source_semester and course_data["source_uuid"]:
                desired_uuid = course_data["source_uuid"]
            else:
                desired_uuid = _generated_uuid(
                    course_data,
                    semester.name,
                    semester.academic_year,
                    occupied,
                )

            collision = db.session.get(Course, desired_uuid)
            if collision and (not existing or collision.uuid != existing.uuid):
                raise ValueError(f"UUID {desired_uuid} 已被其他开课记录使用")

            if existing and existing.uuid != desired_uuid:
                replaced_uuids.add(existing.uuid)
                occupied.discard(existing.uuid)
                db.session.delete(existing)
                db.session.flush()
                existing = None
                uuid_changed += 1

            if not existing:
                existing = Course(uuid=desired_uuid)
                db.session.add(existing)
                if matched_existing:
                    updated += 1
                else:
                    added += 1
            else:
                updated += 1

            occupied.add(desired_uuid)
            retained_uuids.add(desired_uuid)
            _set_course_fields(existing, course_data, semester.name)

        removed = 0
        if mode == "overwrite":
            for existing in existing_courses:
                if existing.uuid in replaced_uuids:
                    continue
                identity = (existing.course_id, str(existing.class_number or ""))
                if identity not in imported_identities or existing.uuid not in retained_uuids:
                    db.session.delete(existing)
                    removed += 1

        db.session.commit()
        result = {
            "message": (
                f"课程导入完成：新增 {added}，更新 {updated}，删除 {removed}，"
                f"UUID 变更 {uuid_changed}"
            ),
            "source_semester": source_semester_name,
            "target_semester": semester.name,
            "semester_created": semester_created,
            "import_mode": mode,
            "added_count": added,
            "updated_count": updated,
            "removed_count": removed,
            "uuid_changed_count": uuid_changed,
        }
        return True, result
    except Exception as exc:
        db.session.rollback()
        return False, {"message": str(exc)}
