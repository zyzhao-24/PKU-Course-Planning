"""Student schedule activity CRUD API."""

from __future__ import annotations

import re
import uuid

from flask import Blueprint, jsonify, request

from auth_utils import student_required
from models import ScheduleActivity, Semester, db


activity_bp = Blueprint('activity', __name__, url_prefix='/api')

ACTIVITY_COLORS = {'blue', 'green', 'amber', 'purple', 'cyan', 'rose', 'yellow', 'lime'}
WEEK_RANGE_PATTERN = re.compile(r"^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$")
CLOCK_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def _semester_max_weeks(semester: Semester) -> int:
    return 5 if semester.term == 3 else 18


def _parse_week_range(raw_value, max_weeks: int) -> str:
    raw = re.sub(r"\s+", "", str(raw_value or ''))
    if not raw or not WEEK_RANGE_PATTERN.fullmatch(raw):
        raise ValueError('周次必须采用 0、1-16 或 1-8,10-16 格式')

    weeks = set()
    for part in raw.split(','):
        if '-' in part:
            start_text, end_text = part.split('-', 1)
            start, end = int(start_text), int(end_text)
        else:
            start = end = int(part)
        if start < 0 or end > max_weeks or start > end:
            raise ValueError(f'周次必须在 0-{max_weeks} 范围内且起始周不大于结束周')
        weeks.update(range(start, end + 1))
    if not weeks:
        raise ValueError('周次不能为空')
    return raw


def _clock_minutes(value: str) -> int:
    if not CLOCK_PATTERN.fullmatch(value):
        raise ValueError('时间必须采用 HH:MM 格式')
    hour, minute = map(int, value.split(':'))
    return hour * 60 + minute


def _validate_recurrence(raw, semester: Semester) -> dict:
    if not isinstance(raw, dict):
        raise ValueError('每个时间条目都必须提供 recurrence 对象')
    recurrence_type = raw.get('type')
    if recurrence_type == 'weeks':
        try:
            day = int(raw.get('day'))
            week_type = int(raw.get('week_type', 0))
        except (TypeError, ValueError) as exc:
            raise ValueError('星期和单双周必须是整数') from exc
        if day < 1 or day > 7:
            raise ValueError('星期必须在 1-7 范围内')
        if week_type not in (0, 1, 2):
            raise ValueError('单双周只能是 0、1 或 2')
        return {
            'type': 'weeks',
            'day': day,
            'week_range': _parse_week_range(raw.get('week_range'), _semester_max_weeks(semester)),
            'week_type': week_type,
        }

    raise ValueError('recurrence.type 只能是 weeks')


def _validate_time(raw) -> dict:
    if not isinstance(raw, dict):
        raise ValueError('每个时间条目都必须提供 time 对象')
    time_type = raw.get('type')
    if time_type == 'periods':
        try:
            start_period = int(raw.get('start_period'))
            end_period = int(raw.get('end_period'))
        except (TypeError, ValueError) as exc:
            raise ValueError('开始和结束节次必须是整数') from exc
        if start_period < 1 or end_period > 12 or start_period > end_period:
            raise ValueError('节次必须在 1-12 范围内且开始节不大于结束节')
        return {
            'type': 'periods',
            'start_period': start_period,
            'end_period': end_period,
        }

    if time_type == 'clock':
        start = str(raw.get('start') or '')
        end = str(raw.get('end') or '')
        if _clock_minutes(start) >= _clock_minutes(end):
            raise ValueError('开始时间必须早于结束时间')
        return {'type': 'clock', 'start': start, 'end': end}

    raise ValueError('time.type 只能是 periods 或 clock')


def validate_activity_payload(payload: dict, *, existing: ScheduleActivity | None = None) -> dict:
    if not isinstance(payload, dict):
        raise ValueError('请求体必须是对象')

    semester_name = str(payload.get('semester', existing.semester if existing else '') or '').strip()
    semester = Semester.query.filter_by(name=semester_name).first()
    if not semester:
        raise ValueError('学期不存在')

    title = str(payload.get('title', existing.title if existing else '') or '').strip()
    if not title:
        raise ValueError('活动名称不能为空')
    if len(title) > 100:
        raise ValueError('活动名称不能超过100个字符')

    color = str(payload.get('color', existing.color if existing else 'green') or '').strip()
    if color not in ACTIVITY_COLORS:
        raise ValueError('活动颜色无效')

    legacy_blocking = payload.get('blocking', True)
    if not isinstance(legacy_blocking, bool):
        raise ValueError('blocking 必须是布尔值')

    notes_value = payload.get('notes', existing.notes if existing else '')
    notes = str(notes_value or '').strip() or None
    if notes and len(notes) > 1000:
        raise ValueError('备注不能超过1000个字符')

    raw_entries = payload.get('time_entries', existing.time_entries if existing else None)
    if not isinstance(raw_entries, list) or not raw_entries:
        raise ValueError('至少需要一个活动时间')
    if len(raw_entries) > 20:
        raise ValueError('一个活动最多包含20个时间条目')

    entries = []
    seen = set()
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict):
            raise ValueError('活动时间条目必须是对象')
        location = str(raw_entry.get('location') or '').strip()
        if len(location) > 200:
            raise ValueError('活动地点不能超过200个字符')
        blocking = raw_entry.get('blocking', legacy_blocking)
        if not isinstance(blocking, bool):
            raise ValueError('每个时间条目的 blocking 必须是布尔值')
        entry = {
            'recurrence': _validate_recurrence(raw_entry.get('recurrence'), semester),
            'time': _validate_time(raw_entry.get('time')),
            'location': location,
            'blocking': blocking,
        }
        signature = repr(entry)
        if signature not in seen:
            seen.add(signature)
            entries.append(entry)

    return {
        'semester': semester.name,
        'title': title,
        'color': color,
        'notes': notes,
        'time_entries': entries,
    }


def serialize_activity(activity: ScheduleActivity) -> dict:
    return {
        'uuid': activity.uuid,
        'semester': activity.semester,
        'title': activity.title,
        'color': activity.color,
        'notes': activity.notes or '',
        'time_entries': activity.time_entries or [],
        'created_at': activity.created_at.isoformat() if activity.created_at else None,
        'updated_at': activity.updated_at.isoformat() if activity.updated_at else None,
    }


@activity_bp.route('/student/activities', methods=['GET'])
@student_required
def list_activities(current_user):
    semester = request.args.get('semester', '').strip()
    query = ScheduleActivity.query.filter_by(user_id=current_user.id)
    if semester:
        query = query.filter_by(semester=semester)
    activities = query.order_by(ScheduleActivity.created_at, ScheduleActivity.uuid).all()
    return jsonify({'success': True, 'activities': [serialize_activity(item) for item in activities]})


@activity_bp.route('/student/activities', methods=['POST'])
@student_required
def create_activity(current_user):
    try:
        values = validate_activity_payload(request.get_json(silent=True) or {})
        activity = ScheduleActivity(
            uuid=f"activity-{uuid.uuid4()}",
            user_id=current_user.id,
            **values,
        )
        db.session.add(activity)
        db.session.commit()
        return jsonify({'success': True, 'activity': serialize_activity(activity)}), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@activity_bp.route('/student/activities/<activity_uuid>', methods=['PUT'])
@student_required
def update_activity(activity_uuid, current_user):
    activity = ScheduleActivity.query.filter_by(uuid=activity_uuid, user_id=current_user.id).first()
    if not activity:
        return jsonify({'success': False, 'message': '活动不存在'}), 404
    try:
        values = validate_activity_payload(request.get_json(silent=True) or {}, existing=activity)
        for key, value in values.items():
            setattr(activity, key, value)
        db.session.commit()
        return jsonify({'success': True, 'activity': serialize_activity(activity)})
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@activity_bp.route('/student/activities/<activity_uuid>', methods=['DELETE'])
@student_required
def delete_activity(activity_uuid, current_user):
    activity = ScheduleActivity.query.filter_by(uuid=activity_uuid, user_id=current_user.id).first()
    if not activity:
        return jsonify({'success': False, 'message': '活动不存在'}), 404
    try:
        db.session.delete(activity)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500
