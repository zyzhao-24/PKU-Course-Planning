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
    CollegeEnglishCoursePool
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

program_bp = Blueprint('program', __name__, url_prefix='/api')

ALLOWED_PROGRAM_IMPORT_EXTENSIONS = {'.xls'}


# ==================== 管理端 API ====================

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
            'categories': [{
                'id': c.id,
                'name': c.name,
                'order_index': c.order_index
            } for c in program.categories]
        }
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
        db.session.commit()
        return jsonify({'success': True})
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
            order_index=data.get('order_index', 0)
        )
        db.session.add(category)
        db.session.commit()
        return jsonify({'success': True, 'id': category.id})
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
        db.session.commit()
        return jsonify({'success': True})
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
            qualification_rules=data.get('qualification_rules', [])
        )
        db.session.add(node)
        db.session.commit()
        return jsonify({'success': True, 'id': node.id})
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
        if 'qualification_rules' in data:
            node.qualification_rules = data['qualification_rules']
        db.session.commit()
        return jsonify({'success': True})
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
            is_dissertation=data.get('is_dissertation', False),
            filters=data.get('filters', {}),
            max_courses=data.get('max_courses'),
            is_repeatable=data.get('is_repeatable', False),
            qualification_rules=data.get('qualification_rules', [])
        )
        db.session.add(course_list)
        db.session.commit()
        return jsonify({'success': True, 'id': course_list.id})
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
        course_list.is_dissertation = data.get('is_dissertation', course_list.is_dissertation)
        course_list.filters = data.get('filters', course_list.filters)
        course_list.max_courses = data.get('max_courses', course_list.max_courses)
        course_list.is_repeatable = data.get('is_repeatable', course_list.is_repeatable)
        if 'qualification_rules' in data:
            course_list.qualification_rules = data['qualification_rules']
        db.session.commit()
        return jsonify({'success': True})
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
