"""Semester-level course calendar adjustment API."""

from __future__ import annotations

from flask import Blueprint, jsonify, request
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError

from auth_utils import admin_required, login_required
from models import (
    ScheduleAdjustment,
    ScheduleAdjustmentEntry,
    Semester,
    db,
)


schedule_adjustment_bp = Blueprint('schedule_adjustment', __name__, url_prefix='/api')


def semester_max_weeks(semester: Semester) -> int:
    return 5 if semester.term == 3 else 18


def serialize_schedule_adjustment(adjustment: ScheduleAdjustment) -> dict:
    return {
        'id': adjustment.id,
        'semester': adjustment.semester,
        'name': adjustment.name,
        'reason': adjustment.reason or '',
        'entries': [
            {
                'id': entry.id,
                'actual': {'week': entry.actual_week, 'day': entry.actual_day},
                'mode': entry.mode,
                **(
                    {'use_schedule_of': {'week': entry.source_week, 'day': entry.source_day}}
                    if entry.mode == 'mapped'
                    else {}
                ),
            }
            for entry in adjustment.entries
        ],
        'created_at': adjustment.created_at.isoformat() if adjustment.created_at else None,
        'updated_at': adjustment.updated_at.isoformat() if adjustment.updated_at else None,
    }


def _parse_slot(raw, field_name: str, max_weeks: int) -> tuple[int, int]:
    if not isinstance(raw, dict):
        raise ValueError(f'{field_name} 必须包含周次和星期')
    try:
        week = int(raw.get('week'))
        day = int(raw.get('day'))
    except (TypeError, ValueError) as exc:
        raise ValueError(f'{field_name} 的周次和星期必须是整数') from exc
    if week < 0 or week > max_weeks:
        raise ValueError(f'{field_name} 的周次必须在 0-{max_weeks} 范围内')
    if day < 1 or day > 7:
        raise ValueError(f'{field_name} 的星期必须在 1-7 范围内')
    return week, day


def validate_schedule_adjustment_payload(
    payload: dict,
    *,
    existing: ScheduleAdjustment | None = None,
) -> tuple[dict, list[dict]]:
    if not isinstance(payload, dict):
        raise ValueError('请求体必须是对象')

    semester_name = str(payload.get('semester', existing.semester if existing else '') or '').strip()
    semester = Semester.query.filter_by(name=semester_name).first()
    if not semester:
        raise ValueError('学期不存在')
    if existing and semester.name != existing.semester:
        raise ValueError('调整方案不能移动到其他学期')

    name = str(payload.get('name', existing.name if existing else '') or '').strip()
    if not name:
        raise ValueError('调整方案名称不能为空')
    if len(name) > 100:
        raise ValueError('调整方案名称不能超过100个字符')

    reason = str(payload.get('reason', existing.reason if existing else '') or '').strip() or None
    if reason and len(reason) > 500:
        raise ValueError('调整原因不能超过500个字符')

    raw_entries = payload.get('entries')
    if not isinstance(raw_entries, list) or not raw_entries:
        raise ValueError('一个调整方案至少需要一条日期设定')
    if len(raw_entries) > 100:
        raise ValueError('一个调整方案最多包含100条日期设定')

    max_weeks = semester_max_weeks(semester)
    parsed_entries = []
    seen_actual = set()
    for index, raw_entry in enumerate(raw_entries, start=1):
        if not isinstance(raw_entry, dict):
            raise ValueError(f'第{index}条日期设定必须是对象')
        actual_week, actual_day = _parse_slot(raw_entry.get('actual'), 'actual', max_weeks)
        actual_key = (actual_week, actual_day)
        if actual_key in seen_actual:
            raise ValueError(f'第{actual_week}周星期{actual_day}在本方案中重复')
        seen_actual.add(actual_key)

        mode = str(raw_entry.get('mode') or '').strip()
        source_week = source_day = None
        if mode == 'mapped':
            source_week, source_day = _parse_slot(
                raw_entry.get('use_schedule_of'),
                'use_schedule_of',
                max_weeks,
            )
            if (source_week, source_day) == actual_key:
                raise ValueError('actual 不能与 use_schedule_of 相同')
        elif mode != 'off':
            raise ValueError('日期设定 mode 只能是 off 或 mapped')

        parsed_entries.append({
            'semester': semester.name,
            'actual_week': actual_week,
            'actual_day': actual_day,
            'mode': mode,
            'source_week': source_week,
            'source_day': source_day,
        })

    duplicate_conditions = [
        and_(
            ScheduleAdjustmentEntry.actual_week == week,
            ScheduleAdjustmentEntry.actual_day == day,
        )
        for week, day in seen_actual
    ]
    duplicate_query = ScheduleAdjustmentEntry.query.filter(
        ScheduleAdjustmentEntry.semester == semester.name,
        or_(*duplicate_conditions),
    )
    if existing:
        duplicate_query = duplicate_query.filter(
            ScheduleAdjustmentEntry.adjustment_id != existing.id,
        )
    duplicate = duplicate_query.first()
    if duplicate:
        raise ValueError(
            f'第{duplicate.actual_week}周星期{duplicate.actual_day}已在其他调整方案中设置'
        )

    return {'semester': semester.name, 'name': name, 'reason': reason}, parsed_entries


@schedule_adjustment_bp.route('/semester-adjustments', methods=['GET'])
@login_required
def list_schedule_adjustments(current_user):
    semester = str(request.args.get('semester') or '').strip()
    query = ScheduleAdjustment.query
    if semester:
        query = query.filter_by(semester=semester)
    adjustments = query.order_by(
        ScheduleAdjustment.semester.desc(),
        ScheduleAdjustment.created_at,
        ScheduleAdjustment.id,
    ).all()
    return jsonify({
        'success': True,
        'adjustments': [serialize_schedule_adjustment(item) for item in adjustments],
    })


@schedule_adjustment_bp.route('/admin/semester-adjustments', methods=['POST'])
@admin_required
def create_schedule_adjustment(current_user):
    try:
        values, entry_values = validate_schedule_adjustment_payload(
            request.get_json(silent=True) or {},
        )
        adjustment = ScheduleAdjustment(**values)
        adjustment.entries = [ScheduleAdjustmentEntry(**entry) for entry in entry_values]
        db.session.add(adjustment)
        db.session.commit()
        return jsonify({
            'success': True,
            'adjustment': serialize_schedule_adjustment(adjustment),
        }), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 400
    except IntegrityError:
        db.session.rollback()
        return jsonify({'success': False, 'message': '同一实际日期只能设置一次'}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@schedule_adjustment_bp.route('/admin/semester-adjustments/<int:adjustment_id>', methods=['PUT'])
@admin_required
def update_schedule_adjustment(adjustment_id, current_user):
    adjustment = db.session.get(ScheduleAdjustment, adjustment_id)
    if not adjustment:
        return jsonify({'success': False, 'message': '调整方案不存在'}), 404
    try:
        values, entry_values = validate_schedule_adjustment_payload(
            request.get_json(silent=True) or {},
            existing=adjustment,
        )
        adjustment.name = values['name']
        adjustment.reason = values['reason']
        for entry in list(adjustment.entries):
            db.session.delete(entry)
        db.session.flush()
        adjustment.entries = [ScheduleAdjustmentEntry(**entry) for entry in entry_values]
        db.session.commit()
        return jsonify({
            'success': True,
            'adjustment': serialize_schedule_adjustment(adjustment),
        })
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 400
    except IntegrityError:
        db.session.rollback()
        return jsonify({'success': False, 'message': '同一实际日期只能设置一次'}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@schedule_adjustment_bp.route('/admin/semester-adjustments/<int:adjustment_id>', methods=['DELETE'])
@admin_required
def delete_schedule_adjustment(adjustment_id, current_user):
    adjustment = db.session.get(ScheduleAdjustment, adjustment_id)
    if not adjustment:
        return jsonify({'success': False, 'message': '调整方案不存在'}), 404
    try:
        db.session.delete(adjustment)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500
