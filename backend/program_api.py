"""
培养方案系统 API v3.0

提供管理端和学生端的 API 接口
"""

import os
import uuid
from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename
from models import (
    db, Program, MainCategory, Node, CourseList, CourseListAssignment, User,
    Transcript, ExchangeTranscript, DissertationTranscript,
    ProgramCourseOption, ProgramMutualExclusionGroup, ProgramRequirementRule,
    ProgramMutualExclusionItem, CollegeEnglishCoursePool, LaborEducationCoursePool
)
from program_calculator import ProgramProgressCalculator
from auth_utils import login_required, admin_required, student_required, get_current_user
from program_xls_parser.db_importer import import_parsed_program
from program_xls_parser.parser import parse_xls
from college_english import (
    get_english_options,
    seed_default_pool,
    serialize_pool_item,
    is_college_english_node,
    validate_english_level,
    validate_english_module,
)
from physical_education import is_physical_education_node
from labor_education import (
    normalize_pool_item as normalize_labor_pool_item,
    seed_default_pool as seed_labor_default_pool,
    serialize_pool_item as serialize_labor_pool_item,
)

PHYSICAL_EDUCATION_EXCLUDED_SOURCE_TYPE = 'pe_excluded'

program_bp = Blueprint('program', __name__, url_prefix='/api')

ALLOWED_PROGRAM_IMPORT_EXTENSIONS = {'.xls'}


# ==================== 管理端 API ====================

def _number_or_none(value):
    if value in (None, ''):
        return None
    return float(value)


def _int_or_none(value):
    if value in (None, ''):
        return None
    return int(value)


def serialize_course_option(option):
    return {
        'id': option.id,
        'program_id': option.program_id,
        'course_list_id': option.course_list_id,
        'course_id': option.course_id,
        'course_name': option.course_name,
        'credits': option.credits,
        'total_hours': option.total_hours,
        'practice_total_hours': option.practice_total_hours,
        'semester': option.semester,
        'source_excel_row': option.source_excel_row,
        'raw_payload': option.raw_payload or {},
        'order_index': option.order_index,
    }


def serialize_requirement_rule(rule):
    return {
        'id': rule.id,
        'program_id': rule.program_id,
        'owner_type': rule.owner_type,
        'owner_id': rule.owner_id,
        'raw': rule.raw,
        'parsed': rule.parsed or {},
        'target_names': rule.target_names or [],
        'metric': rule.metric,
        'operator': rule.operator,
        'value': rule.value,
        'order_index': rule.order_index,
        'source_excel_row': rule.source_excel_row,
    }


def serialize_mutual_exclusion_group(group):
    return {
        'id': group.id,
        'program_id': group.program_id,
        'owner_type': group.owner_type,
        'owner_id': group.owner_id,
        'raw': group.raw,
        'strategy': group.strategy or {},
        'order_index': group.order_index,
        'source_excel_row': group.source_excel_row,
        'items': [{
            'id': item.id,
            'course_id': item.course_id,
            'order_index': item.order_index,
        } for item in group.items],
    }


def serialize_course_list_full(course_list):
    return {
        'id': course_list.id,
        'type': 'course_list',
        'name': course_list.name,
        'order_index': course_list.order_index,
        'raw': course_list.raw,
        'remark': course_list.remark,
        'course_category': course_list.course_category,
        'requirement_raw': course_list.requirement_raw,
        'requirement_type': course_list.requirement_type,
        'requirement_min': course_list.requirement_min,
        'requirement_max': course_list.requirement_max,
        'source_excel_row': course_list.source_excel_row,
        'selection_rule': course_list.selection_rule or {},
        'is_dissertation': course_list.is_dissertation,
        'filters': course_list.filters or {},
        'max_courses': course_list.max_courses,
        'is_repeatable': course_list.is_repeatable,
        'qualification_rules': course_list.qualification_rules or [],
        'course_options': [serialize_course_option(option) for option in course_list.course_options],
    }


def serialize_node_full(node):
    children = Node.query.filter_by(parent_id=node.id).order_by(Node.order_index).all()
    return {
        'id': node.id,
        'type': 'node',
        'name': node.name,
        'parent_id': node.parent_id,
        'order_index': node.order_index,
        'raw': node.raw,
        'node_kind': node.node_kind,
        'remark': node.remark,
        'requirement_raw': node.requirement_raw,
        'requirement_type': node.requirement_type,
        'requirement_min': node.requirement_min,
        'requirement_max': node.requirement_max,
        'source_excel_row': node.source_excel_row,
        'rules_raw': node.rules_raw or [],
        'qualification_rules': node.qualification_rules or [],
        'course_lists': [serialize_course_list_full(item) for item in node.course_lists],
        'children': [serialize_node_full(child) for child in children],
    }


def serialize_category_full(category):
    root_nodes = Node.query.filter_by(
        main_category_id=category.id,
        parent_id=None
    ).order_by(Node.order_index).all()
    return {
        'id': category.id,
        'name': category.name,
        'order_index': category.order_index,
        'raw': category.raw,
        'remark': category.remark,
        'requirement_raw': category.requirement_raw,
        'requirement_type': category.requirement_type,
        'requirement_min': category.requirement_min,
        'requirement_max': category.requirement_max,
        'source_excel_row': category.source_excel_row,
        'nodes': [serialize_node_full(node) for node in root_nodes],
    }


def serialize_program_full(program):
    return {
        'id': program.id,
        'name': program.name,
        'dept': program.dept,
        'channel': program.channel,
        'year': program.year,
        'created_at': program.created_at.isoformat() if program.created_at else None,
        'source_info': program.source_info or {},
        'source_filename': (program.source_info or {}).get('original_filename') or (program.source_info or {}).get('filename'),
        'program_metadata': program.program_metadata or {},
        'total_credits': program.total_credits,
        'raw_payload': program.raw_payload or {},
        'import_warnings': program.import_warnings or [],
        'categories': [serialize_category_full(category) for category in program.categories],
        'requirement_rules': [
            serialize_requirement_rule(rule)
            for rule in ProgramRequirementRule.query.filter_by(program_id=program.id)
            .order_by(ProgramRequirementRule.order_index, ProgramRequirementRule.id)
            .all()
        ],
        'mutual_exclusion_groups': [
            serialize_mutual_exclusion_group(group)
            for group in ProgramMutualExclusionGroup.query.filter_by(program_id=program.id)
            .order_by(ProgramMutualExclusionGroup.order_index, ProgramMutualExclusionGroup.id)
            .all()
        ],
    }


def sync_course_list_filter_course_ids(course_list):
    course_ids = [
        option.course_id
        for option in ProgramCourseOption.query.filter_by(course_list_id=course_list.id)
        .order_by(ProgramCourseOption.order_index, ProgramCourseOption.id)
        .all()
        if option.course_id
    ]
    filters = dict(course_list.filters or {})
    if course_ids:
        filters['course_id'] = list(dict.fromkeys(course_ids))
    else:
        filters.pop('course_id', None)
    course_list.filters = filters

@program_bp.route('/admin/programs', methods=['GET'])
@admin_required
def get_programs(current_user):
    """获取所有培养方案"""
    programs = Program.query.order_by(Program.year.desc(), Program.name).all()
    return jsonify({
        'success': True,
        'programs': [{
            'id': p.id,
            'name': p.name,
            'dept': p.dept,
            'channel': p.channel,
            'year': p.year,
            'source_filename': (p.source_info or {}).get('original_filename') or (p.source_info or {}).get('filename')
        } for p in programs]
    })


@program_bp.route('/admin/programs/import', methods=['POST'])
@admin_required
def import_program(current_user):
    """上传并导入培养方案 XLS 文件"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No file provided'}), 400

    uploaded_file = request.files['file']
    if uploaded_file.filename == '':
        return jsonify({'success': False, 'message': 'No selected file'}), 400

    original_filename = uploaded_file.filename
    suffix = Path(original_filename).suffix.lower()
    if suffix not in ALLOWED_PROGRAM_IMPORT_EXTENSIONS:
        return jsonify({'success': False, 'message': '仅支持 .xls 格式的培养方案文件'}), 400

    saved_path = None
    try:
        upload_dir = get_program_upload_dir()
        upload_dir.mkdir(parents=True, exist_ok=True)

        safe_stem = secure_filename(Path(original_filename).stem) or 'program'
        safe_name = f'{safe_stem}{suffix}'
        saved_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}_{safe_name}"
        saved_path = upload_dir / saved_name
        uploaded_file.save(saved_path)

        parsed = parse_xls(str(saved_path))
        program = import_parsed_program(
            parsed,
            name=_optional_form_value('name'),
            dept=_optional_form_value('dept'),
            channel=_optional_int_form_value('channel', 0),
            year=_optional_int_form_value('year'),
            commit=False,
        )

        source_info = dict(program.source_info or {})
        source_info.update({
            'original_filename': original_filename,
            'stored_filename': saved_name,
            'stored_path': str(saved_path),
            'stored_relative_path': str(saved_path.relative_to(upload_dir)),
            'stored_size': saved_path.stat().st_size,
            'uploaded_at': datetime.utcnow().isoformat() + 'Z',
        })
        program.source_info = source_info

        db.session.commit()
        stats = collect_program_import_stats(program.id)
        return jsonify({
            'success': True,
            'message': f'成功导入培养方案：{program.name}',
            'program': {
                'id': program.id,
                'name': program.name,
                'dept': program.dept,
                'channel': program.channel,
                'year': program.year,
                'source_filename': source_info.get('original_filename'),
            },
            'stats': stats,
        })
    except Exception as e:
        db.session.rollback()
        if saved_path and saved_path.exists():
            try:
                saved_path.unlink()
            except OSError:
                pass
        return jsonify({'success': False, 'message': str(e)}), 500


def get_program_upload_dir() -> Path:
    configured = os.environ.get('PROGRAM_UPLOAD_DIR')
    if configured:
        return Path(configured)

    appdata = os.environ.get('APPDATA')
    if appdata:
        return Path(appdata) / 'courseplanningsystem' / 'program_uploads'

    return Path(os.path.dirname(os.path.abspath(__file__))).parent / 'program_uploads'


def _optional_form_value(key):
    value = request.form.get(key)
    if value is None:
        return None
    value = value.strip()
    return value or None


def _optional_int_form_value(key, default=None):
    value = _optional_form_value(key)
    if value is None:
        return default
    return int(value)


def collect_program_import_stats(program_id):
    category_ids = [
        row.id
        for row in MainCategory.query.with_entities(MainCategory.id)
        .filter_by(program_id=program_id)
        .all()
    ]
    node_ids = []
    if category_ids:
        node_ids = [
            row.id
            for row in Node.query.with_entities(Node.id)
            .filter(Node.main_category_id.in_(category_ids))
            .all()
        ]

    group_count = 0
    if node_ids:
        group_count = CourseList.query.filter(CourseList.node_id.in_(node_ids)).count()

    return {
        'categories': len(category_ids),
        'modules': len(node_ids),
        'groups': group_count,
        'options': ProgramCourseOption.query.filter_by(program_id=program_id).count(),
        'rules': ProgramRequirementRule.query.filter_by(program_id=program_id).count(),
        'mutual_exclusions': ProgramMutualExclusionGroup.query.filter_by(program_id=program_id).count(),
    }


@program_bp.route('/admin/programs', methods=['POST'])
@admin_required
def create_program(current_user):
    """创建培养方案"""
    data = request.json
    try:
        program = Program(
            name=data['name'],
            dept=data.get('dept'),
            channel=data['channel'],
            year=data['year']
        )
        db.session.add(program)
        db.session.commit()
        return jsonify({'success': True, 'id': program.id})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/programs/<int:program_id>', methods=['GET'])
@admin_required
def get_program(program_id, current_user):
    """获取培养方案详情"""
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'success': False, 'message': 'Program not found'}), 404
    
    return jsonify({
        'success': True,
        'program': {
            'id': program.id,
            'name': program.name,
            'dept': program.dept,
            'channel': program.channel,
            'year': program.year,
            'source_info': program.source_info or {},
            'program_metadata': program.program_metadata or {},
            'total_credits': program.total_credits,
            'raw_payload': program.raw_payload or {},
            'import_warnings': program.import_warnings or [],
            'categories': [{
                'id': c.id,
                'name': c.name,
                'order_index': c.order_index
            } for c in program.categories]
        }
    })


@program_bp.route('/admin/programs/<int:program_id>/full', methods=['GET'])
@admin_required
def get_program_full(program_id, current_user):
    """获取培养方案完整可编辑结构"""
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'success': False, 'message': 'Program not found'}), 404

    return jsonify({
        'success': True,
        'program': serialize_program_full(program),
    })


@program_bp.route('/admin/programs/<int:program_id>', methods=['PUT'])
@admin_required
def update_program(program_id, current_user):
    """更新培养方案"""
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'success': False, 'message': 'Program not found'}), 404
    
    data = request.json
    try:
        program.name = data.get('name', program.name)
        program.dept = data.get('dept', program.dept)
        program.year = data.get('year', program.year)
        if 'channel' in data:
            program.channel = int(data['channel'])
        if 'source_info' in data:
            program.source_info = data['source_info'] or {}
        if 'program_metadata' in data:
            program.program_metadata = data['program_metadata'] or {}
        if 'total_credits' in data:
            program.total_credits = _number_or_none(data.get('total_credits'))
        if 'raw_payload' in data:
            program.raw_payload = data['raw_payload'] or {}
        if 'import_warnings' in data:
            program.import_warnings = data['import_warnings'] or []
        db.session.commit()
        return jsonify({'success': True, 'program': serialize_program_full(program)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/programs/<int:program_id>', methods=['DELETE'])
@admin_required
def delete_program(program_id, current_user):
    """删除培养方案"""
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'success': False, 'message': 'Program not found'}), 404
    
    try:
        db.session.delete(program)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== 主类别 API ====================

@program_bp.route('/admin/programs/<int:program_id>/categories', methods=['GET'])
@admin_required
def get_categories(program_id, current_user):
    """获取培养方案的主类别"""
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'success': False, 'message': 'Program not found'}), 404
    
    return jsonify({
        'success': True,
        'categories': [{
            'id': c.id,
            'name': c.name,
            'order_index': c.order_index
        } for c in program.categories]
    })


@program_bp.route('/admin/programs/<int:program_id>/categories', methods=['POST'])
@admin_required
def create_category(program_id, current_user):
    """创建主类别"""
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'success': False, 'message': 'Program not found'}), 404
    
    data = request.json
    try:
        category = MainCategory(
            program_id=program_id,
            name=data['name'],
            order_index=data.get('order_index', 0),
            raw=data.get('raw'),
            remark=data.get('remark'),
            requirement_raw=data.get('requirement_raw'),
            requirement_type=data.get('requirement_type'),
            requirement_min=_number_or_none(data.get('requirement_min')),
            requirement_max=_number_or_none(data.get('requirement_max')),
            source_excel_row=_int_or_none(data.get('source_excel_row')),
        )
        db.session.add(category)
        db.session.commit()
        return jsonify({'success': True, 'id': category.id, 'category': serialize_category_full(category)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/categories/<int:category_id>', methods=['PUT'])
@admin_required
def update_category(category_id, current_user):
    """更新主类别"""
    category = MainCategory.query.get(category_id)
    if not category:
        return jsonify({'success': False, 'message': 'Category not found'}), 404
    
    data = request.json
    try:
        category.name = data.get('name', category.name)
        category.order_index = data.get('order_index', category.order_index)
        if 'raw' in data:
            category.raw = data.get('raw')
        if 'remark' in data:
            category.remark = data.get('remark')
        if 'requirement_raw' in data:
            category.requirement_raw = data.get('requirement_raw')
        if 'requirement_type' in data:
            category.requirement_type = data.get('requirement_type')
        if 'requirement_min' in data:
            category.requirement_min = _number_or_none(data.get('requirement_min'))
        if 'requirement_max' in data:
            category.requirement_max = _number_or_none(data.get('requirement_max'))
        if 'source_excel_row' in data:
            category.source_excel_row = _int_or_none(data.get('source_excel_row'))
        db.session.commit()
        return jsonify({'success': True, 'category': serialize_category_full(category)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/categories/<int:category_id>', methods=['DELETE'])
@admin_required
def delete_category(category_id, current_user):
    """删除主类别"""
    category = MainCategory.query.get(category_id)
    if not category:
        return jsonify({'success': False, 'message': 'Category not found'}), 404
    
    try:
        db.session.delete(category)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== 节点 API ====================

@program_bp.route('/admin/categories/<int:category_id>/nodes', methods=['GET'])
@admin_required
def get_nodes(category_id, current_user):
    """获取主类别下的节点树"""
    category = MainCategory.query.get(category_id)
    if not category:
        return jsonify({'success': False, 'message': 'Category not found'}), 404
    
    # 获取根节点
    root_nodes = Node.query.filter_by(
        main_category_id=category_id,
        parent_id=None
    ).order_by(Node.order_index).all()
    
    def build_tree(node):
        children = Node.query.filter_by(parent_id=node.id).order_by(Node.order_index).all()
        course_lists = CourseList.query.filter_by(node_id=node.id).order_by(CourseList.order_index).all()
        
        return {
            'id': node.id,
            'name': node.name,
            'order_index': node.order_index,
            'qualification_rules': node.qualification_rules,
            'children': [build_tree(c) for c in children],
            'course_lists': [{
                'id': cl.id,
                'name': cl.name,
                'is_dissertation': cl.is_dissertation,
                'filters': cl.filters,
                'max_courses': cl.max_courses,
                'is_repeatable': cl.is_repeatable,
                'qualification_rules': cl.qualification_rules
            } for cl in course_lists]
        }
    
    return jsonify({
        'success': True,
        'nodes': [build_tree(n) for n in root_nodes]
    })


@program_bp.route('/admin/categories/<int:category_id>/nodes', methods=['POST'])
@admin_required
def create_node(category_id, current_user):
    """创建节点"""
    category = MainCategory.query.get(category_id)
    if not category:
        return jsonify({'success': False, 'message': 'Category not found'}), 404
    
    data = request.json
    try:
        node = Node(
            main_category_id=category_id,
            parent_id=data.get('parent_id'),
            name=data['name'],
            order_index=data.get('order_index', 0),
            raw=data.get('raw'),
            node_kind=data.get('node_kind', 'module'),
            remark=data.get('remark'),
            requirement_raw=data.get('requirement_raw'),
            requirement_type=data.get('requirement_type'),
            requirement_min=_number_or_none(data.get('requirement_min')),
            requirement_max=_number_or_none(data.get('requirement_max')),
            source_excel_row=_int_or_none(data.get('source_excel_row')),
            rules_raw=data.get('rules_raw', []),
            qualification_rules=data.get('qualification_rules', [])
        )
        db.session.add(node)
        db.session.commit()
        return jsonify({'success': True, 'id': node.id, 'node': serialize_node_full(node)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/nodes/<int:node_id>', methods=['PUT'])
@admin_required
def update_node(node_id, current_user):
    """更新节点"""
    node = Node.query.get(node_id)
    if not node:
        return jsonify({'success': False, 'message': 'Node not found'}), 404
    
    data = request.json
    try:
        node.name = data.get('name', node.name)
        node.order_index = data.get('order_index', node.order_index)
        if 'parent_id' in data:
            node.parent_id = data.get('parent_id')
        if 'raw' in data:
            node.raw = data.get('raw')
        if 'node_kind' in data:
            node.node_kind = data.get('node_kind') or 'module'
        if 'remark' in data:
            node.remark = data.get('remark')
        if 'requirement_raw' in data:
            node.requirement_raw = data.get('requirement_raw')
        if 'requirement_type' in data:
            node.requirement_type = data.get('requirement_type')
        if 'requirement_min' in data:
            node.requirement_min = _number_or_none(data.get('requirement_min'))
        if 'requirement_max' in data:
            node.requirement_max = _number_or_none(data.get('requirement_max'))
        if 'source_excel_row' in data:
            node.source_excel_row = _int_or_none(data.get('source_excel_row'))
        if 'rules_raw' in data:
            node.rules_raw = data['rules_raw'] or []
        if 'qualification_rules' in data:
            node.qualification_rules = data['qualification_rules']
        db.session.commit()
        return jsonify({'success': True, 'node': serialize_node_full(node)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/nodes/<int:node_id>', methods=['DELETE'])
@admin_required
def delete_node(node_id, current_user):
    """删除节点"""
    node = Node.query.get(node_id)
    if not node:
        return jsonify({'success': False, 'message': 'Node not found'}), 404
    
    try:
        db.session.delete(node)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== 课程列表 API ====================

@program_bp.route('/admin/nodes/<int:node_id>/course-lists', methods=['POST'])
@admin_required
def create_course_list(node_id, current_user):
    """创建课程列表"""
    node = Node.query.get(node_id)
    if not node:
        return jsonify({'success': False, 'message': 'Node not found'}), 404
    
    data = request.json
    try:
        course_list = CourseList(
            node_id=node_id,
            name=data['name'],
            order_index=data.get('order_index', 0),
            raw=data.get('raw'),
            remark=data.get('remark'),
            course_category=data.get('course_category'),
            requirement_raw=data.get('requirement_raw'),
            requirement_type=data.get('requirement_type'),
            requirement_min=_number_or_none(data.get('requirement_min')),
            requirement_max=_number_or_none(data.get('requirement_max')),
            source_excel_row=_int_or_none(data.get('source_excel_row')),
            selection_rule=data.get('selection_rule', {}),
            is_dissertation=data.get('is_dissertation', False),
            filters=data.get('filters', {}),
            max_courses=data.get('max_courses'),
            is_repeatable=data.get('is_repeatable', False),
            qualification_rules=data.get('qualification_rules', [])
        )
        db.session.add(course_list)
        db.session.commit()
        return jsonify({'success': True, 'id': course_list.id, 'course_list': serialize_course_list_full(course_list)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/course-lists/<int:list_id>', methods=['PUT'])
@admin_required
def update_course_list(list_id, current_user):
    """更新课程列表"""
    course_list = CourseList.query.get(list_id)
    if not course_list:
        return jsonify({'success': False, 'message': 'Course list not found'}), 404
    
    data = request.json
    try:
        course_list.name = data.get('name', course_list.name)
        course_list.order_index = data.get('order_index', course_list.order_index)
        if 'raw' in data:
            course_list.raw = data.get('raw')
        if 'remark' in data:
            course_list.remark = data.get('remark')
        if 'course_category' in data:
            course_list.course_category = data.get('course_category')
        if 'requirement_raw' in data:
            course_list.requirement_raw = data.get('requirement_raw')
        if 'requirement_type' in data:
            course_list.requirement_type = data.get('requirement_type')
        if 'requirement_min' in data:
            course_list.requirement_min = _number_or_none(data.get('requirement_min'))
        if 'requirement_max' in data:
            course_list.requirement_max = _number_or_none(data.get('requirement_max'))
        if 'source_excel_row' in data:
            course_list.source_excel_row = _int_or_none(data.get('source_excel_row'))
        if 'selection_rule' in data:
            course_list.selection_rule = data['selection_rule'] or {}
        course_list.is_dissertation = data.get('is_dissertation', course_list.is_dissertation)
        course_list.filters = data.get('filters', course_list.filters)
        course_list.max_courses = data.get('max_courses', course_list.max_courses)
        course_list.is_repeatable = data.get('is_repeatable', course_list.is_repeatable)
        if 'qualification_rules' in data:
            course_list.qualification_rules = data['qualification_rules']
        db.session.commit()
        return jsonify({'success': True, 'course_list': serialize_course_list_full(course_list)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/course-lists/<int:list_id>', methods=['DELETE'])
@admin_required
def delete_course_list(list_id, current_user):
    """删除课程列表"""
    course_list = CourseList.query.get(list_id)
    if not course_list:
        return jsonify({'success': False, 'message': 'Course list not found'}), 404
    
    try:
        db.session.delete(course_list)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== 导入明细 API ====================

@program_bp.route('/admin/course-lists/<int:list_id>/course-options', methods=['GET'])
@admin_required
def get_course_options(list_id, current_user):
    course_list = CourseList.query.get(list_id)
    if not course_list:
        return jsonify({'success': False, 'message': 'Course list not found'}), 404

    return jsonify({
        'success': True,
        'course_options': [serialize_course_option(option) for option in course_list.course_options],
    })


@program_bp.route('/admin/course-lists/<int:list_id>/course-options', methods=['POST'])
@admin_required
def create_course_option(list_id, current_user):
    course_list = CourseList.query.get(list_id)
    if not course_list:
        return jsonify({'success': False, 'message': 'Course list not found'}), 404

    data = request.json or {}
    try:
        option = ProgramCourseOption(
            program_id=course_list.node.main_category.program_id,
            course_list_id=course_list.id,
            course_id=(data.get('course_id') or '').strip() or None,
            course_name=(data.get('course_name') or '').strip() or None,
            credits=_number_or_none(data.get('credits')),
            total_hours=_number_or_none(data.get('total_hours')),
            practice_total_hours=_number_or_none(data.get('practice_total_hours')),
            semester=(data.get('semester') or '').strip() or None,
            source_excel_row=_int_or_none(data.get('source_excel_row')),
            raw_payload=data.get('raw_payload') or {},
            order_index=int(data.get('order_index') or 0),
        )
        db.session.add(option)
        db.session.flush()
        sync_course_list_filter_course_ids(course_list)
        db.session.commit()
        return jsonify({
            'success': True,
            'course_option': serialize_course_option(option),
            'course_list': serialize_course_list_full(course_list),
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/course-options/<int:option_id>', methods=['PUT'])
@admin_required
def update_course_option(option_id, current_user):
    option = ProgramCourseOption.query.get(option_id)
    if not option:
        return jsonify({'success': False, 'message': 'Course option not found'}), 404

    data = request.json or {}
    try:
        if 'course_id' in data:
            option.course_id = (data.get('course_id') or '').strip() or None
        if 'course_name' in data:
            option.course_name = (data.get('course_name') or '').strip() or None
        if 'credits' in data:
            option.credits = _number_or_none(data.get('credits'))
        if 'total_hours' in data:
            option.total_hours = _number_or_none(data.get('total_hours'))
        if 'practice_total_hours' in data:
            option.practice_total_hours = _number_or_none(data.get('practice_total_hours'))
        if 'semester' in data:
            option.semester = (data.get('semester') or '').strip() or None
        if 'source_excel_row' in data:
            option.source_excel_row = _int_or_none(data.get('source_excel_row'))
        if 'raw_payload' in data:
            option.raw_payload = data.get('raw_payload') or {}
        if 'order_index' in data:
            option.order_index = int(data.get('order_index') or 0)
        sync_course_list_filter_course_ids(option.course_list)
        db.session.commit()
        return jsonify({
            'success': True,
            'course_option': serialize_course_option(option),
            'course_list': serialize_course_list_full(option.course_list),
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/course-options/<int:option_id>', methods=['DELETE'])
@admin_required
def delete_course_option(option_id, current_user):
    option = ProgramCourseOption.query.get(option_id)
    if not option:
        return jsonify({'success': False, 'message': 'Course option not found'}), 404

    try:
        course_list = option.course_list
        db.session.delete(option)
        db.session.flush()
        sync_course_list_filter_course_ids(course_list)
        db.session.commit()
        return jsonify({'success': True, 'course_list': serialize_course_list_full(course_list)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/programs/<int:program_id>/requirement-rules', methods=['POST'])
@admin_required
def create_requirement_rule(program_id, current_user):
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'success': False, 'message': 'Program not found'}), 404

    data = request.json or {}
    try:
        rule = ProgramRequirementRule(
            program_id=program_id,
            owner_type=data.get('owner_type') or 'program',
            owner_id=_int_or_none(data.get('owner_id')),
            raw=data.get('raw') or '',
            parsed=data.get('parsed') or {},
            target_names=data.get('target_names') or [],
            metric=data.get('metric'),
            operator=data.get('operator'),
            value=_number_or_none(data.get('value')),
            order_index=int(data.get('order_index') or 0),
            source_excel_row=_int_or_none(data.get('source_excel_row')),
        )
        db.session.add(rule)
        db.session.commit()
        return jsonify({'success': True, 'requirement_rule': serialize_requirement_rule(rule)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/requirement-rules/<int:rule_id>', methods=['PUT'])
@admin_required
def update_requirement_rule(rule_id, current_user):
    rule = ProgramRequirementRule.query.get(rule_id)
    if not rule:
        return jsonify({'success': False, 'message': 'Requirement rule not found'}), 404

    data = request.json or {}
    try:
        for field in ('owner_type', 'raw', 'metric', 'operator'):
            if field in data:
                setattr(rule, field, data.get(field) or ('' if field == 'raw' else None))
        if 'owner_id' in data:
            rule.owner_id = _int_or_none(data.get('owner_id'))
        if 'parsed' in data:
            rule.parsed = data.get('parsed') or {}
        if 'target_names' in data:
            rule.target_names = data.get('target_names') or []
        if 'value' in data:
            rule.value = _number_or_none(data.get('value'))
        if 'order_index' in data:
            rule.order_index = int(data.get('order_index') or 0)
        if 'source_excel_row' in data:
            rule.source_excel_row = _int_or_none(data.get('source_excel_row'))
        db.session.commit()
        return jsonify({'success': True, 'requirement_rule': serialize_requirement_rule(rule)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/requirement-rules/<int:rule_id>', methods=['DELETE'])
@admin_required
def delete_requirement_rule(rule_id, current_user):
    rule = ProgramRequirementRule.query.get(rule_id)
    if not rule:
        return jsonify({'success': False, 'message': 'Requirement rule not found'}), 404

    try:
        db.session.delete(rule)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/programs/<int:program_id>/mutual-exclusions', methods=['POST'])
@admin_required
def create_mutual_exclusion_group(program_id, current_user):
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'success': False, 'message': 'Program not found'}), 404

    data = request.json or {}
    try:
        group = ProgramMutualExclusionGroup(
            program_id=program_id,
            owner_type=data.get('owner_type') or 'program',
            owner_id=_int_or_none(data.get('owner_id')),
            raw=data.get('raw') or '',
            strategy=data.get('strategy') or {},
            order_index=int(data.get('order_index') or 0),
            source_excel_row=_int_or_none(data.get('source_excel_row')),
        )
        db.session.add(group)
        db.session.flush()
        _replace_mutual_exclusion_items(group, data.get('items') or [])
        db.session.commit()
        return jsonify({'success': True, 'mutual_exclusion_group': serialize_mutual_exclusion_group(group)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/mutual-exclusions/<int:group_id>', methods=['PUT'])
@admin_required
def update_mutual_exclusion_group(group_id, current_user):
    group = ProgramMutualExclusionGroup.query.get(group_id)
    if not group:
        return jsonify({'success': False, 'message': 'Mutual exclusion group not found'}), 404

    data = request.json or {}
    try:
        for field in ('owner_type', 'raw'):
            if field in data:
                setattr(group, field, data.get(field) or ('' if field == 'raw' else None))
        if 'owner_id' in data:
            group.owner_id = _int_or_none(data.get('owner_id'))
        if 'strategy' in data:
            group.strategy = data.get('strategy') or {}
        if 'order_index' in data:
            group.order_index = int(data.get('order_index') or 0)
        if 'source_excel_row' in data:
            group.source_excel_row = _int_or_none(data.get('source_excel_row'))
        if 'items' in data:
            _replace_mutual_exclusion_items(group, data.get('items') or [])
        db.session.commit()
        return jsonify({'success': True, 'mutual_exclusion_group': serialize_mutual_exclusion_group(group)})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/admin/mutual-exclusions/<int:group_id>', methods=['DELETE'])
@admin_required
def delete_mutual_exclusion_group(group_id, current_user):
    group = ProgramMutualExclusionGroup.query.get(group_id)
    if not group:
        return jsonify({'success': False, 'message': 'Mutual exclusion group not found'}), 404

    try:
        db.session.delete(group)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


def _replace_mutual_exclusion_items(group, items):
    ProgramMutualExclusionItem.query.filter_by(group_id=group.id).delete()
    for index, item in enumerate(items):
        course_id = item.get('course_id') if isinstance(item, dict) else item
        course_id = str(course_id or '').strip()
        if not course_id:
            continue
        db.session.add(ProgramMutualExclusionItem(
            group_id=group.id,
            course_id=course_id,
            order_index=int(item.get('order_index', index) if isinstance(item, dict) else index),
        ))


# ==================== 学生方案分配 API ====================

@program_bp.route('/admin/users/<int:user_id>/assign-programs', methods=['POST'])
@admin_required
def assign_programs(user_id, current_user):
    """为学生分配培养方案"""
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'message': 'User not found'}), 404
    
    data = request.json
    try:
        if 'major_program_id' in data:
            user.major_program_id = data['major_program_id']
        if 'minor_program_id' in data:
            user.minor_program_id = data['minor_program_id']
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== 学生端 API ====================

@program_bp.route('/student/program-options', methods=['GET'])
@login_required
def get_student_program_options(current_user):
    """获取当前用户可选择的培养方案"""
    programs = Program.query.order_by(Program.year.desc(), Program.name).all()
    return jsonify({
        'success': True,
        'programs': [{
            'id': p.id,
            'name': p.name,
            'dept': p.dept,
            'channel': p.channel,
            'year': p.year,
        } for p in programs]
    })


@program_bp.route('/student/program-settings', methods=['PUT'])
@login_required
def update_student_program_settings(current_user):
    """更新当前用户的培养方案设置"""
    data = request.json or {}

    try:
        major_program_id = (
            _optional_program_id(data.get('major_program_id'), '主修方案')
            if 'major_program_id' in data
            else current_user.major_program_id
        )
        minor_program_id = (
            _optional_program_id(data.get('minor_program_id'), '辅双方案')
            if 'minor_program_id' in data
            else current_user.minor_program_id
        )

        if major_program_id:
            major_program = Program.query.get(major_program_id)
            if not major_program or major_program.channel != 0:
                return jsonify({'success': False, 'message': '主修方案无效'}), 400

        if minor_program_id:
            minor_program = Program.query.get(minor_program_id)
            if not minor_program or minor_program.channel != 1:
                return jsonify({'success': False, 'message': '辅双方案无效'}), 400

        current_user.major_program_id = major_program_id
        current_user.minor_program_id = minor_program_id
        if 'english_level' in data:
            current_user.english_level = validate_english_level(data.get('english_level'))
        db.session.commit()
        return jsonify({
            'success': True,
            'user': {
                'id': current_user.id,
                'username': current_user.username,
                'name': current_user.name,
                'role': current_user.role,
                'major_program_id': current_user.major_program_id,
                'minor_program_id': current_user.minor_program_id,
                'english_level': current_user.english_level,
            }
        })
    except ValueError as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


def _optional_program_id(value, label):
    if value in (None, ''):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f'{label}无效')


# ==================== 大学英语设置 API ====================

@program_bp.route('/college-english/options', methods=['GET'])
@login_required
def get_college_english_options(current_user):
    return jsonify({
        'success': True,
        **get_english_options(current_user.english_level)
    })


@program_bp.route('/college-english/pool', methods=['GET'])
@login_required
def get_college_english_pool(current_user):
    module = request.args.get('module')
    keyword = (request.args.get('keyword') or '').strip()
    include_inactive = request.args.get('include_inactive', 'true').lower() == 'true'

    query = CollegeEnglishCoursePool.query
    if module:
        validate_english_module(module)
        query = query.filter_by(module=module)
    if not include_inactive:
        query = query.filter_by(active=True)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            (CollegeEnglishCoursePool.course_id.like(like)) |
            (CollegeEnglishCoursePool.course_name.like(like))
        )

    items = query.order_by(
        CollegeEnglishCoursePool.module,
        CollegeEnglishCoursePool.order_index,
        CollegeEnglishCoursePool.course_id
    ).all()
    return jsonify({
        'success': True,
        'items': [serialize_pool_item(item) for item in items],
        **get_english_options(current_user.english_level),
    })


@program_bp.route('/college-english/pool', methods=['POST'])
@login_required
def create_college_english_pool_item(current_user):
    data = request.json or {}
    try:
        item = CollegeEnglishCoursePool(
            course_id=str(data.get('course_id') or '').strip(),
            course_name=str(data.get('course_name') or '').strip(),
            module=validate_english_module(data.get('module')),
            active=bool(data.get('active', True)),
            notes=(data.get('notes') or '').strip() or None,
            order_index=int(data.get('order_index') or 0),
        )
        if not item.course_id or not item.course_name:
            return jsonify({'success': False, 'message': '课程号和课程名不能为空'}), 400

        db.session.add(item)
        db.session.commit()
        return jsonify({'success': True, 'item': serialize_pool_item(item)})
    except ValueError as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/college-english/pool/<int:item_id>', methods=['PUT'])
@login_required
def update_college_english_pool_item(item_id, current_user):
    item = CollegeEnglishCoursePool.query.get(item_id)
    if not item:
        return jsonify({'success': False, 'message': 'College English pool item not found'}), 404

    data = request.json or {}
    try:
        if 'course_id' in data:
            item.course_id = str(data.get('course_id') or '').strip()
        if 'course_name' in data:
            item.course_name = str(data.get('course_name') or '').strip()
        if 'module' in data:
            item.module = validate_english_module(data.get('module'))
        if 'active' in data:
            item.active = bool(data.get('active'))
        if 'notes' in data:
            item.notes = (data.get('notes') or '').strip() or None
        if 'order_index' in data:
            item.order_index = int(data.get('order_index') or 0)
        if not item.course_id or not item.course_name:
            return jsonify({'success': False, 'message': '课程号和课程名不能为空'}), 400

        db.session.commit()
        return jsonify({'success': True, 'item': serialize_pool_item(item)})
    except ValueError as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/college-english/pool/<int:item_id>', methods=['DELETE'])
@login_required
def delete_college_english_pool_item(item_id, current_user):
    item = CollegeEnglishCoursePool.query.get(item_id)
    if not item:
        return jsonify({'success': False, 'message': 'College English pool item not found'}), 404

    try:
        db.session.delete(item)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@program_bp.route('/college-english/pool/reset-defaults', methods=['POST'])
@login_required
def reset_college_english_pool(current_user):
    try:
        count = seed_default_pool(reset=True)
        items = CollegeEnglishCoursePool.query.order_by(
            CollegeEnglishCoursePool.module,
            CollegeEnglishCoursePool.order_index,
            CollegeEnglishCoursePool.course_id
        ).all()
        return jsonify({
            'success': True,
            'created': count,
            'items': [serialize_pool_item(item) for item in items],
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== 劳动教育课程池管理 API ====================

@program_bp.route('/labor-education/pool', methods=['GET'])
@admin_required
def get_labor_education_pool(current_user):
    keyword = (request.args.get('keyword') or '').strip()
    course_system = (request.args.get('course_system') or '').strip()
    query = LaborEducationCoursePool.query
    if course_system:
        query = query.filter_by(course_system=course_system)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            (LaborEducationCoursePool.course_id.like(like)) |
            (LaborEducationCoursePool.course_name.like(like))
        )
    items = query.order_by(
        LaborEducationCoursePool.course_system,
        LaborEducationCoursePool.course_id,
    ).all()
    systems = [row[0] for row in db.session.query(
        LaborEducationCoursePool.course_system
    ).distinct().order_by(LaborEducationCoursePool.course_system).all()]
    return jsonify({
        'success': True,
        'items': [serialize_labor_pool_item(item) for item in items],
        'course_systems': systems,
    })


@program_bp.route('/labor-education/pool', methods=['POST'])
@admin_required
def create_labor_education_pool_item(current_user):
    try:
        item = LaborEducationCoursePool(**normalize_labor_pool_item(request.json or {}))
        if LaborEducationCoursePool.query.filter_by(course_id=item.course_id).first():
            return jsonify({'success': False, 'message': 'course_id already exists'}), 400
        db.session.add(item)
        db.session.commit()
        return jsonify({'success': True, 'item': serialize_labor_pool_item(item)})
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@program_bp.route('/labor-education/pool/<int:item_id>', methods=['PUT'])
@admin_required
def update_labor_education_pool_item(item_id, current_user):
    item = LaborEducationCoursePool.query.get(item_id)
    if not item:
        return jsonify({'success': False, 'message': 'Labor education pool item not found'}), 404
    try:
        data = request.json or {}
        values = normalize_labor_pool_item({
            'course_id': data.get('course_id', item.course_id),
            'course_name': data.get('course_name', item.course_name),
            'course_system': data.get('course_system', item.course_system),
            'credits': data.get('credits', item.credits),
            'labor_hours': data.get('labor_hours', item.labor_hours),
        })
        duplicate = LaborEducationCoursePool.query.filter(
            LaborEducationCoursePool.course_id == values['course_id'],
            LaborEducationCoursePool.id != item_id,
        ).first()
        if duplicate:
            return jsonify({'success': False, 'message': 'course_id already exists'}), 400
        for key, value in values.items():
            setattr(item, key, value)
        db.session.commit()
        return jsonify({'success': True, 'item': serialize_labor_pool_item(item)})
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@program_bp.route('/labor-education/pool/<int:item_id>', methods=['DELETE'])
@admin_required
def delete_labor_education_pool_item(item_id, current_user):
    item = LaborEducationCoursePool.query.get(item_id)
    if not item:
        return jsonify({'success': False, 'message': 'Labor education pool item not found'}), 404
    try:
        db.session.delete(item)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@program_bp.route('/labor-education/pool/reset-defaults', methods=['POST'])
@admin_required
def reset_labor_education_pool(current_user):
    try:
        count = seed_labor_default_pool(reset=True)
        items = LaborEducationCoursePool.query.order_by(
            LaborEducationCoursePool.course_system,
            LaborEducationCoursePool.course_id,
        ).all()
        return jsonify({
            'success': True,
            'created': count,
            'items': [serialize_labor_pool_item(item) for item in items],
        })
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@program_bp.route('/student/progress', methods=['GET'])
@student_required
def get_student_progress(current_user):
    """获取学生的培养方案进度"""
    calculator = ProgramProgressCalculator(current_user.id)
    results = calculator.calculate_all()
    return jsonify({
        'success': True,
        'progress': results
    })


@program_bp.route('/student/progress/recalculate', methods=['POST'])
@student_required
def recalculate_progress(current_user):
    """重新计算培养方案进度"""
    calculator = ProgramProgressCalculator(current_user.id)
    calculator.recalculate()
    return jsonify({'success': True, 'message': 'Recalculation completed'})


@program_bp.route('/student/assignments/<int:assignment_id>', methods=['PUT'])
@student_required
def update_assignment(assignment_id, current_user):
    """手动调整课程归属"""
    assignment = CourseListAssignment.query.filter_by(
        id=assignment_id,
        user_id=current_user.id
    ).first()
    
    if not assignment:
        return jsonify({'success': False, 'message': 'Assignment not found'}), 404
    
    data = request.json
    try:
        # 更新归属的课程列表
        new_list_id = data.get('course_list_id')
        if new_list_id is not None:
            assignment.course_list_id = new_list_id
            db.session.commit()
        
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500





@program_bp.route('/student/courses/move', methods=['POST'])
@student_required
def move_course(current_user):
    """
    移动课程到另一个不可重复列表，或取消分配
    
    请求体：
    {
        "source_uuid": "课程执行计划编号",
        "to_list_id": 目标列表ID（null表示取消分配）,
        "channel": 0或1
    }
    """
    from program_calculator import CourseMoveManager
    
    data = request.json
    source_uuid = data.get('source_uuid')
    from_list_id = data.get('from_list_id')
    to_list_id = data.get('to_list_id')  # null 表示取消分配
    channel = data.get('channel', 0)
    
    if not source_uuid:
        return jsonify({
            'success': False, 
            'message': '缺少必要参数：source_uuid'
        }), 400
    
    # 获取培养方案ID
    user = User.query.get(current_user.id)
    program_id = user.major_program_id if channel == 0 else user.minor_program_id
    
    if not program_id:
        return jsonify({
            'success': False,
            'message': '未分配培养方案'
        }), 400
    
    # 取消分配
    if to_list_id is None:
        if _is_physical_education_course_list(from_list_id):
            try:
                assignment = CourseListAssignment.query.filter_by(
                    user_id=current_user.id,
                    source_type='course',
                    source_uuid=source_uuid,
                ).first()
                if assignment:
                    assignment.course_list_id = None
                else:
                    db.session.add(CourseListAssignment(
                        user_id=current_user.id,
                        course_list_id=None,
                        source_type='course',
                        source_uuid=source_uuid,
                    ))
                exclusion = CourseListAssignment.query.filter_by(
                    user_id=current_user.id,
                    source_type=PHYSICAL_EDUCATION_EXCLUDED_SOURCE_TYPE,
                    source_uuid=source_uuid,
                ).first()
                if not exclusion:
                    db.session.add(CourseListAssignment(
                        user_id=current_user.id,
                        course_list_id=None,
                        source_type=PHYSICAL_EDUCATION_EXCLUDED_SOURCE_TYPE,
                        source_uuid=source_uuid,
                    ))
                db.session.commit()
                return jsonify({'success': True, 'message': '已从体育课取消分配'})
            except Exception as e:
                db.session.rollback()
                return jsonify({'success': False, 'message': f'取消分配失败：{str(e)}'}), 500

        try:
            if _is_college_english_course_list(from_list_id):
                # Keep the normal course assignment in sync with the manual
                # exclusion. Otherwise the old English list assignment makes
                # the course disappear from both the English node and the
                # unassigned area.
                assignment = CourseListAssignment.query.filter_by(
                    user_id=current_user.id,
                    source_type='course',
                    source_uuid=source_uuid,
                ).first()
                if assignment:
                    assignment.course_list_id = None
                exclusion = CourseListAssignment.query.filter_by(
                    user_id=current_user.id,
                    source_type='college_english_excluded',
                    source_uuid=source_uuid
                ).first()
                if not exclusion:
                    db.session.add(CourseListAssignment(
                        user_id=current_user.id,
                        course_list_id=None,
                        source_type='college_english_excluded',
                        source_uuid=source_uuid
                    ))
                db.session.commit()
                return jsonify({'success': True, 'message': '已从大学英语模块取消分配'})

            assignment = CourseListAssignment.query.filter_by(
                user_id=current_user.id,
                source_type='course',
                source_uuid=source_uuid
            ).first()
            
            if assignment:
                # 已有记录，设置为未分配
                assignment.course_list_id = None
            else:
                # 没有记录，创建一条未分配的记录
                assignment = CourseListAssignment(
                    user_id=current_user.id,
                    course_list_id=None,  # 未分配
                    source_type='course',
                    source_uuid=source_uuid
                )
                db.session.add(assignment)
            
            db.session.commit()
            
            return jsonify({'success': True, 'message': '已取消分配'})
            
        except Exception as e:
            db.session.rollback()
            return jsonify({
                'success': False,
                'message': f'取消分配失败：{str(e)}'
            }), 500
    
    # 移动到其他列表
    manager = CourseMoveManager(current_user.id, channel, program_id)
    success, message = manager.move(source_uuid, to_list_id)
    
    if success:
        return jsonify({'success': True, 'message': message})
    else:
        return jsonify({'success': False, 'message': message}), 400




@program_bp.route('/student/courses/can-move', methods=['POST'])
@student_required
def can_move_course(current_user):
    """
    检查课程可以移动到哪些不可重复列表
    
    请求体：
    {
        "source_uuid": "课程执行计划编号",
        "channel": 0或1
    }
    
    返回：
    {
        "success": true,
        "target_lists": [
            {
                "id": 列表ID,
                "name": "列表名称",
                "full_path": "完整路径",
                "match_level": 匹配层级,
                "max_courses": 最大门数限制
            }
        ],
        "can_unassign": true/false
    }
    """
    from program_calculator import CourseMoveManager, CourseInfoResolver
    
    data = request.json
    source_uuid = data.get('source_uuid')
    from_list_id = data.get('from_list_id')
    channel = data.get('channel', 0)
    
    if not source_uuid:
        return jsonify({
            'success': False, 
            'message': '缺少必要参数: source_uuid'
        }), 400
    
    # 验证课程存在
    info = CourseInfoResolver.resolve(current_user.id, source_uuid, channel)
    if not info:
        return jsonify({
            'success': False,
            'message': '未找到课程信息'
        }), 404
    
    # 获取培养方案ID
    user = User.query.get(current_user.id)
    program_id = user.major_program_id if channel == 0 else user.minor_program_id
    
    if not program_id:
        return jsonify({
            'success': True,
            'target_lists': [],
            'can_unassign': False
        })
    
    # 获取可用目标列表（带完整路径）
    program = Program.query.get(program_id)
    target_lists = []
    
    for category in program.categories:
        for node in category.nodes:
            target_lists.extend(_get_course_lists_with_path(node, category.name, ''))
    
    # 过滤并添加匹配信息
    matcher = CourseMoveManager(current_user.id, channel, program_id).matcher
    available_lists = []
    
    for cl in target_lists:
        if cl['is_dissertation'] or cl['is_repeatable']:
            continue
        
        # 检查是否已满
        count = CourseListAssignment.query.filter_by(
            user_id=current_user.id,
            course_list_id=cl['id']
        ).count()
        
        if cl['max_courses'] and count >= cl['max_courses']:
            continue
        
        # 检查是否匹配
        level = matcher.get_match_level(info, cl['filters'] or {})
        if level < 5:  # 匹配
            available_lists.append({
                'id': cl['id'],
                'name': cl['name'],
                'full_path': cl['full_path'],
                'match_level': level,
                'max_courses': cl['max_courses']
            })
    
    # 按匹配层级排序
    available_lists.sort(key=lambda x: x['match_level'])
    
    # 检查是否可以取消分配
    # 如果调用方传入当前所在课程列表，则以该列表作为来源判断。
    # 大学英语模块是规则自动计算出来的课程列表，通常没有普通分配记录，
    # 取消分配时会写入 college_english_excluded 记录来阻止再次自动归入。
    if _is_college_english_course_list(from_list_id):
        return jsonify({
            'success': True,
            'target_lists': available_lists,
            'can_unassign': True
        })

    if _is_physical_education_course_list(from_list_id):
        return jsonify({
            'success': True,
            'target_lists': available_lists,
            'can_unassign': True
        })

    # 只要课程存在（本通道的课程），就可以取消分配
    # 如果没有分配记录，会自动创建一条 course_list_id=None 的记录
    current_assignment = CourseListAssignment.query.filter_by(
        user_id=current_user.id,
        source_type='course',
        source_uuid=source_uuid
    ).first()
    
    # 如果课程已分配到某个列表，或者有分配记录，或者至少课程存在，都可以取消分配
    if current_assignment:
        # 已有分配记录 - 只要已分配到某个列表就可以取消
        can_unassign = current_assignment.course_list_id is not None
    else:
        # 没有分配记录 - 检查课程是否存在于本通道
        # 如果存在，就可以创建记录并取消分配
        from program_calculator import CourseInfoResolver
        course_info = CourseInfoResolver.resolve(current_user.id, source_uuid, channel)
        can_unassign = course_info is not None
    
    return jsonify({
        'success': True,
        'target_lists': available_lists,
        'can_unassign': can_unassign
    })


def _get_course_lists_with_path(node, category_name, parent_path):
    results = []
    current_path = f"{category_name} > {parent_path} > {node.name}" if parent_path else f"{category_name} > {node.name}"
    
    for cl in node.course_lists:
        results.append({
            'id': cl.id,
            'name': cl.name,
            'full_path': f"{current_path} > {cl.name}",
            'is_dissertation': cl.is_dissertation,
            'is_repeatable': cl.is_repeatable,
            'filters': cl.filters,
            'max_courses': cl.max_courses
        })
    
    for child in node.children:
        results.extend(_get_course_lists_with_path(child, category_name, current_path))
    
    return results


def _is_college_english_course_list(course_list_id) -> bool:
    try:
        parsed_id = int(course_list_id)
    except (TypeError, ValueError):
        return str(course_list_id or '').startswith('college-english-')

    course_list = CourseList.query.get(parsed_id)
    if not course_list or not course_list.node or not course_list.node.main_category:
        return False
    return is_college_english_node(course_list.node.main_category.name, course_list.node.name)


def _is_physical_education_course_list(course_list_id) -> bool:
    try:
        parsed_id = int(course_list_id)
    except (TypeError, ValueError):
        return str(course_list_id or '').startswith('physical-education-')

    course_list = CourseList.query.get(parsed_id)
    if not course_list or not course_list.node:
        return False
    return is_physical_education_node(course_list.node.name)
