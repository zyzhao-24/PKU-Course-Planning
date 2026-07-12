from flask import Flask, jsonify, request, send_from_directory, send_file
from flask_cors import CORS
import os
import sys
import bcrypt
import tempfile
from playwright.sync_api import sync_playwright

# Add current directory to path to allow imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Determine if compiled (PyInstaller frozen or Nuitka standalone)
_is_frozen = getattr(sys, 'frozen', False)
_is_nuitka = not _is_frozen and 'python' not in os.path.basename(sys.executable).lower()
_is_compiled = _is_frozen or _is_nuitka

# 配置 Playwright 浏览器路径（打包后）
if _is_compiled:
    # PyInstaller 打包后的路径 - 查找 headless shell
    import glob
    playwright_base = os.path.join(sys._MEIPASS, 'playwright')
    headless_paths = glob.glob(os.path.join(playwright_base, 'chromium_headless_shell-*'))
    
    if headless_paths:
        # 使用 headless shell 路径
        os.environ['PLAYWRIGHT_BROWSERS_PATH'] = playwright_base
        print(f"Playwright headless shell path set to: {playwright_base}")
    elif os.path.exists(playwright_base):
        # 使用普通 chromium 路径
        os.environ['PLAYWRIGHT_BROWSERS_PATH'] = playwright_base
        print(f"Playwright browsers path set to: {playwright_base}")
    else:
        # 备用方案：使用 0 表示使用 bundled 浏览器
        os.environ['PLAYWRIGHT_BROWSERS_PATH'] = '0'
        print("Using bundled Playwright browsers")

from database import init_db, db
from models import *
from datetime import datetime, date

# 导入培养方案新系统
from program_api import program_bp

from importer import import_courses_from_json

from auth_utils import (
    verify_pku_credentials,
    generate_jwt_token,
    create_or_update_student,
    create_admin_user,
    login_required,
    student_required,
    admin_required,
    get_current_user,
    rate_limit,
    # Portal session functions (for transcript sync)
    get_portal_session,
    clear_portal_session,
    # New auth functions
    create_login_session,
    switch_login_method,
    check_mobile_auth,
    get_captcha_image,
    send_sms_code,
    get_qr_image,
    password_login as student_password_login,
    poll_qr_login,
    finalize_login,
    check_portal_login_status,
    decrypt_session_password,
    get_session_public_key,
    get_student_scores,
    get_student_schedule
)
from secure_auth import (
    get_rsa_public_key,
    decrypt_credentials,
    remove_rsa_key
)

if _is_compiled:
    BASE_RESOURCE_DIR = getattr(sys, '_MEIPASS', None) or os.path.dirname(sys.executable)
    STATIC_FOLDER = os.path.join(BASE_RESOURCE_DIR, 'frontend', 'dist')
else:
    BASE_EXEC_DIR = os.path.dirname(os.path.abspath(__file__))
    STATIC_FOLDER = os.path.join(BASE_EXEC_DIR, '..', 'frontend', 'dist')

app = Flask(__name__, static_folder=STATIC_FOLDER, static_url_path='')
# 配置 CORS - 限制可信任来源
# 开发环境：http://localhost:3000 (Vite dev server)
# 生产环境：file:// (Electron loadFile) => origin: null
CORS(app, resources={r"/api/*": {
    "origins": ["http://localhost:3000", "http://127.0.0.1:3000",
                "https://localhost:5000", "https://127.0.0.1:5000",
                "http://localhost:5000", "http://127.0.0.1:5000",
                "https://localhost:5001", "https://127.0.0.1:5001",
                "http://localhost:5001", "http://127.0.0.1:5001",
                "null"],  # Electron file:// protocol
    "supports_credentials": True
}})

# Database configuration
if _is_compiled:
    DB_PATH = os.path.join(os.path.dirname(sys.executable), 'course_planning.db')
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    DB_PATH = os.path.join(BASE_DIR, '..', 'course_planning.db')

app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{DB_PATH}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False


# Initialize database
init_db(app)

# 注册培养方案新系统的 blueprint
app.register_blueprint(program_bp)

# ==================== 安全认证路由 ====================

@app.route('/api/auth/public-key', methods=['POST'])
def get_public_key():
    """
    获取RSA公钥
    请求: {username: string}
    返回: {success: true, key_id: string, public_key: string} 或错误信息
    """
    data = request.json or {}
    username = data.get('username', '').strip()
    
    if not username:
        return jsonify({'success': False, 'message': '用户名不能为空'}), 400
    
    result = get_rsa_public_key(username)
    if result:
        return jsonify({
            'success': True,
            'key_id': result['key_id'],
            'public_key': result['public_key']
        })
    else:
        return jsonify({'success': False, 'message': '无法生成RSA密钥'}), 500


@app.route('/api/auth/login', methods=['POST'])
@rate_limit(max_attempts=10, window_seconds=60)
def login():
    """
    统一登录接口（使用RSA加密传输）
    请求: {
        username: string,
        encrypted_credentials: string,  # RSA加密的base64编码JSON: {username, password}
        key_id: string,
        type: 'student' | 'admin'
    }
    """
    data = request.json or {}
    username = data.get('username', '').strip()
    encrypted_credentials = data.get('encrypted_credentials', '').strip()
    key_id = data.get('key_id', '').strip()
    login_type = data.get('type', 'student')  # 'student' 或 'admin'
    
    if not username or not encrypted_credentials:
        return jsonify({'success': False, 'message': '请输入用户名和加密凭据'}), 400
    
    # 解密凭据（传入key_id进行验证）
    success, result = decrypt_credentials(username, encrypted_credentials, key_id)
    if not success:
        return jsonify({'success': False, 'message': result}), 401
    
    password = result['password']
    
    if login_type == 'student':
        # 学生使用北大IAAA认证（旧方式，兼容）
        success, auth_result, cookie_str = verify_pku_credentials(username, password)
        
        # 无论成功失败，都移除RSA密钥（一次性使用）
        remove_rsa_key(username)
        
        if not success:
            return jsonify({'success': False, 'message': auth_result}), 401
        
        # 创建或更新学生账号
        user = create_or_update_student(
            username=auth_result['username'],
            name=auth_result.get('name')
        )
        
        # 生成JWT
        token = generate_jwt_token(user)
        
        return jsonify({
            'success': True,
            'token': token,
            'user': {
                'id': user.id,
                'username': user.username,
                'name': user.name,
                'role': user.role,
                'major_program_id': user.major_program_id,
                'minor_program_id': user.minor_program_id
            }
        })
    
    elif login_type == 'admin':
        # 管理员使用本地密码验证
        user = User.query.filter_by(username=username, role='admin').first()
        if not user or not user.password_hash:
            # 移除RSA密钥
            remove_rsa_key(username)
            return jsonify({'success': False, 'message': '管理员账号不存在'}), 401
        
        # 验证密码
        if not bcrypt.checkpw(password.encode('utf-8'), user.password_hash.encode('utf-8')):
            # 移除RSA密钥
            remove_rsa_key(username)
            return jsonify({'success': False, 'message': '密码错误'}), 401
        
        # 登录成功，移除RSA密钥
        remove_rsa_key(username)
        
        # 更新最后登录时间
        user.last_login = datetime.utcnow()
        db.session.commit()
        
        # 生成JWT
        token = generate_jwt_token(user)
        
        return jsonify({
            'success': True,
            'token': token,
            'user': {
                'id': user.id,
                'username': user.username,
                'name': user.name,
                'role': user.role
            }
        })
    
    else:
        # 移除RSA密钥
        remove_rsa_key(username)
        return jsonify({'success': False, 'message': '未知的登录类型'}), 400


@app.route('/api/auth/me', methods=['GET'])
@login_required
def get_current_user_info(current_user):
    """获取当前用户信息"""
    return jsonify({
        'success': True,
        'user': {
            'id': current_user.id,
            'username': current_user.username,
            'name': current_user.name,
            'role': current_user.role,
            'major_program_id': current_user.major_program_id,
            'minor_program_id': current_user.minor_program_id
        }
    })


# ==================== 学生登录路由（新） ====================

@app.route('/api/auth/student/init', methods=['POST'])
def student_login_init():
    """
    初始化学生登录会话
    请求: {method: 'password' | 'qr'}
    返回: {success: true, session_id: string, key_id?: string, public_key?: string}
    """
    data = request.json or {}
    method = data.get('method', 'password')
    
    if method not in ['password', 'qr']:
        return jsonify({'success': False, 'message': '无效的登录方式'}), 400
    
    session_id, key_info = create_login_session(method)
    
    if not session_id:
        return jsonify({'success': False, 'message': '无法创建登录会话'}), 500
    
    response = {
        'success': True,
        'session_id': session_id,
        'method': method
    }
    
    # 密码登录时返回RSA公钥
    if key_info:
        response['key_id'] = key_info['key_id']
        response['public_key'] = key_info['public_key']
    
    return jsonify(response)


@app.route('/api/auth/student/public-key', methods=['GET'])
def student_get_session_public_key():
    """
    获取会话的RSA公钥
    查询参数: session_id
    """
    session_id = request.args.get('session_id', '').strip()
    
    if not session_id:
        return jsonify({'success': False, 'message': '缺少会话ID'}), 400
    
    success, result = get_session_public_key(session_id)
    
    if not success:
        return jsonify({'success': False, 'message': result}), 400
    
    return jsonify({
        'success': True,
        'key_id': result['key_id'],
        'public_key': result['public_key']
    })


@app.route('/api/auth/student/switch-method', methods=['POST'])
def student_switch_login_method():
    """
    切换登录方式
    请求: {session_id: string, new_method: 'password' | 'qr'}
    """
    data = request.json or {}
    session_id = data.get('session_id', '').strip()
    new_method = data.get('new_method', '').strip()
    
    if not session_id or not new_method:
        return jsonify({'success': False, 'message': '缺少必要参数'}), 400
    
    if new_method not in ['password', 'qr']:
        return jsonify({'success': False, 'message': '无效的登录方式'}), 400
    
    success, error = switch_login_method(session_id, new_method)
    
    if not success:
        return jsonify({'success': False, 'message': error}), 400
    
    # 切换后如果是密码登录，返回新的RSA公钥
    if new_method == 'password':
        success, key_info = get_session_public_key(session_id)
        if success:
            return jsonify({
                'success': True,
                'method': new_method,
                'key_id': key_info['key_id'],
                'public_key': key_info['public_key']
            })
    
    return jsonify({
        'success': True,
        'method': new_method
    })


@app.route('/api/auth/student/check-auth', methods=['POST'])
@rate_limit(max_attempts=10, window_seconds=60)
def student_check_mobile_auth():
    """
    检查手机号认证需求
    请求: {session_id: string, username: string}
    返回: {requires_captcha, requires_sms, requires_otp, requires_bind_otp, mobile_mask}
    """
    data = request.json or {}
    session_id = data.get('session_id', '').strip()
    username = data.get('username', '').strip()
    
    if not session_id or not username:
        return jsonify({'success': False, 'message': '缺少必要参数'}), 400
    
    try:
        success, result = check_mobile_auth(session_id, username)
        
        if not success:
            return jsonify({'success': False, 'message': result}), 400
        
        return jsonify({
            'success': True,
            **result
        })
    except Exception as e:
        import traceback
        print(f"check-auth error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': f'服务器错误: {str(e)}'}), 500


@app.route('/api/auth/student/captcha', methods=['GET'])
def student_get_captcha():
    """
    获取验证码图片
    查询参数: session_id
    """
    session_id = request.args.get('session_id', '').strip()
    
    if not session_id:
        return jsonify({'success': False, 'message': '缺少会话ID'}), 400
    
    success, result = get_captcha_image(session_id)
    
    if not success:
        return jsonify({'success': False, 'message': result}), 400
    
    return jsonify({
        'success': True,
        'captcha_image': result  # base64 encoded
    })


@app.route('/api/auth/student/sms', methods=['POST'])
@rate_limit(max_attempts=3, window_seconds=120)
def student_send_sms():
    """
    发送短信验证码
    请求: {session_id: string}
    """
    data = request.json or {}
    session_id = data.get('session_id', '').strip()
    
    if not session_id:
        return jsonify({'success': False, 'message': '缺少会话ID'}), 400
    
    success, result = send_sms_code(session_id)
    
    if not success:
        return jsonify({'success': False, 'message': result}), 400
    
    return jsonify({
        'success': True,
        'mobile_mask': result.get('mobileMask', '')
    })


@app.route('/api/auth/student/qr', methods=['GET'])
def student_get_qr():
    """
    获取二维码图片
    查询参数: session_id, username(可选)
    """
    session_id = request.args.get('session_id', '').strip()
    username = request.args.get('username', '').strip() or None
    
    if not session_id:
        return jsonify({'success': False, 'message': '缺少会话ID'}), 400
    
    success, result = get_qr_image(session_id, username)
    
    if not success:
        return jsonify({'success': False, 'message': result}), 400
    
    return jsonify({
        'success': True,
        'qr_image': result  # base64 encoded
    })


@app.route('/api/auth/student/login-password', methods=['POST'])
@rate_limit(max_attempts=5, window_seconds=60)
def student_login_password():
    """
    密码登录
    请求: {
        session_id: string,
        encrypted_password: string,  # RSA加密后的密码
        captcha?: string,
        sms_code?: string,
        otp_code?: string
    }
    """
    data = request.json or {}
    session_id = data.get('session_id', '').strip()
    encrypted_password = data.get('encrypted_password', '').strip()
    captcha = data.get('captcha', '').strip()
    sms_code = data.get('sms_code', '').strip()
    otp_code = data.get('otp_code', '').strip()
    
    if not session_id or not encrypted_password:
        return jsonify({'success': False, 'message': '缺少必要参数'}), 400
    
    # 解密密码
    success, password = decrypt_session_password(session_id, encrypted_password)
    if not success:
        return jsonify({'success': False, 'message': password}), 400
    
    # 执行登录
    success, result, user_info = student_password_login(
        session_id, password, captcha, sms_code, otp_code
    )
    
    if not success:
        # 登录失败，检查是否需要新验证码
        error_msg = result
        needs_new_captcha = 'E03' in error_msg  # 验证码错误
        
        response = {
            'success': False,
            'message': error_msg
        }
        
        if needs_new_captcha:
            # 获取新验证码
            captcha_success, captcha_result = get_captcha_image(session_id)
            if captcha_success:
                response['captcha_image'] = captcha_result
                response['requires_captcha'] = True
        
        return jsonify(response), 401
    
    # 登录成功，完成登录流程
    user, _ = finalize_login(session_id, user_info)
    
    if not user:
        return jsonify({'success': False, 'message': '登录处理失败'}), 500
    
    # 生成JWT
    token = generate_jwt_token(user)
    
    return jsonify({
        'success': True,
        'token': token,
        'user': {
            'id': user.id,
            'username': user.username,
            'name': user.name,
            'role': user.role,
            'major_program_id': user.major_program_id,
            'minor_program_id': user.minor_program_id
        }
    })


@app.route('/api/auth/student/qr-poll', methods=['POST'])
def student_login_qr_poll():
    """
    轮询二维码登录状态
    请求: {session_id: string}
    """
    data = request.json or {}
    session_id = data.get('session_id', '').strip()
    
    if not session_id:
        return jsonify({'success': False, 'message': '缺少会话ID'}), 400
    
    success, result, user_info = poll_qr_login(session_id)
    
    if not success:
        return jsonify({
            'success': False,
            'status': 'error',
            'message': result,
            'is_stop': True
        }), 400
    
    # 检查是否登录成功
    if user_info:
        # 登录成功，完成登录流程
        # QR登录成功后，user_info 中包含 username
        user, _ = finalize_login(session_id, user_info)
        
        if not user:
            return jsonify({'success': False, 'message': '登录处理失败'}), 500
        
        # 生成JWT
        token = generate_jwt_token(user)
        
        return jsonify({
            'success': True,
            'token': token,
            'user': {
                'id': user.id,
                'username': user.username,
                'name': user.name,
                'role': user.role,
                'major_program_id': user.major_program_id,
                'minor_program_id': user.minor_program_id
            }
        })
    
    
    # 未成功，返回状态
    return jsonify({
        'success': True,
        **result
    })


@app.route('/api/auth/check', methods=['GET'])
def check_auth_status():
    """
    检查登录状态（页面刷新时调用）
    需要JWT Token
    """
    user = get_current_user()
    
    if not user:
        return jsonify({
            'success': False,
            'authenticated': False,
            'force_logout': True,
            'message': '未登录或Token已过期'
        }), 401
    
    # 学生需要检查portal会话
    if user.role == 'student':
        is_valid, message = check_portal_login_status(user.id)
        
        if not is_valid:
            # Portal会话过期，清除后端会话并强制前端退出
            clear_portal_session(user.id)
            return jsonify({
                'success': False,
                'authenticated': False,
                'portal_expired': True,
                'force_logout': True,
                'message': message
            }), 401
    
    return jsonify({
        'success': True,
        'authenticated': True,
        'user': {
            'id': user.id,
            'username': user.username,
            'name': user.name,
            'role': user.role,
            'major_program_id': user.major_program_id,
            'minor_program_id': user.minor_program_id
        }
    })


# ==================== 公共路由（学生和 admin 均可） ====================

@app.route('/api/health')
def health_check():
    return jsonify({"status": "ok", "message": "Backend is running"})

@app.route('/api/shutdown', methods=['POST'])
def shutdown():
    """优雅关闭：确保数据库写入完成"""
    try:
        db.session.commit()
        db.session.close()
    except:
        pass
    return jsonify({"status": "ok"})


@app.route('/api/semesters', methods=['GET'])
@login_required
def get_semesters(current_user):
    """获取所有学期列表（从学期表独立获取）"""
    # 从学期表独立获取，不从课程表
    semesters = Semester.query.order_by(Semester.academic_year.desc(), Semester.term).all()
    semester_list = [s.name for s in semesters]
    
    # 获取学期配置信息
    semester_configs = {}
    for cfg in semesters:
        semester_configs[cfg.name] = {
            'academic_year': cfg.academic_year,
            'term': cfg.term,
            'first_week_monday': cfg.first_week_monday.isoformat() if cfg.first_week_monday else None
        }
    
    return jsonify({
        'semesters': semester_list,
        'configs': semester_configs
    })


@app.route('/api/admin/semesters', methods=['POST'])
@admin_required
def admin_create_semester(current_user):
    """管理员创建学期"""
    data = request.json
    name = data.get('name')
    academic_year = data.get('academic_year')
    term = data.get('term')
    first_week_monday = data.get('first_week_monday')
    
    if not name or not academic_year or not term:
        return jsonify({'success': False, 'message': '学期名称、学年和学期必填'}), 400
    
    try:
        # 检查是否已存在
        existing = Semester.query.filter_by(name=name).first()
        if existing:
            return jsonify({'success': False, 'message': f'学期 {name} 已存在'}), 400
        
        semester = Semester(
            name=name,
            academic_year=academic_year,
            term=term,
            first_week_monday=date.fromisoformat(first_week_monday) if first_week_monday else None
        )
        db.session.add(semester)
        db.session.commit()
        
        return jsonify({
            'success': True, 
            'message': '学期创建成功',
            'semester': {
                'name': semester.name,
                'academic_year': semester.academic_year,
                'term': semester.term,
                'first_week_monday': semester.first_week_monday.isoformat() if semester.first_week_monday else None
            }
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/admin/semesters/<name>', methods=['DELETE'])
@admin_required
def admin_delete_semester(current_user, name):
    """管理员删除学期（会级联删除该学期下的所有课程）"""
    semester = Semester.query.filter_by(name=name).first()
    if not semester:
        return jsonify({'success': False, 'message': '学期不存在'}), 404
    
    try:
        # 级联删除由模型中的 relationship 处理
        db.session.delete(semester)
        db.session.commit()
        return jsonify({
            'success': True, 
            'message': f'学期 {name} 及其所有课程已删除'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/admin/semesters/<name>', methods=['PUT'])
@admin_required
def admin_update_semester(current_user, name):
    """管理员更新学期配置"""
    data = request.json
    first_week_monday = data.get('first_week_monday')
    
    semester = Semester.query.filter_by(name=name).first()
    if not semester:
        return jsonify({'success': False, 'message': '学期不存在'}), 404
    
    try:
        if first_week_monday:
            semester.first_week_monday = date.fromisoformat(first_week_monday)
        else:
            semester.first_week_monday = None
            
        db.session.commit()
        return jsonify({
            'success': True, 
            'message': '学期配置已更新',
            'semester': {
                'name': semester.name,
                'first_week_monday': semester.first_week_monday.isoformat() if semester.first_week_monday else None
            }
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/course_types', methods=['GET'])
@login_required
def get_course_types(current_user):
    """获取课程类型列表"""
    semester = request.args.get('semester', '')
    query = db.session.query(Course.course_type).distinct()
    if semester:
        query = query.filter(Course.semester == semester)
    types = [t[0] for t in query.all() if t[0]]
    return jsonify({'types': sorted(types)})


@app.route('/api/courses', methods=['GET'])
@login_required
def get_courses(current_user):
    """获取课程列表（分页，per_page=0时不分页）"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 0, type=int)
    
    # Filters（支持单个值或列表）
    semester = request.args.get('semester', '')
    
    # course_id: 非列表时模糊匹配，列表时精确匹配任意一项
    search_id = [v for v in request.args.getlist('course_id[]') if v]
    search_id = search_id or request.args.get('course_id', '')
    
    # course_name: 模糊匹配
    search_name = request.args.get('course_name', '')
    
    # 支持单个值或列表的筛选参数（过滤空值）
    department_code = [v for v in request.args.getlist('department_code[]') if v]
    if not department_code:
        department_code = request.args.get('department_code', '')
        if department_code:
            department_code = [department_code]
        else:
            department_code = []
    course_type = [v for v in request.args.getlist('course_type[]') if v]
    if not course_type:
        course_type = request.args.get('course_type', '')
        if course_type:
            course_type = [course_type]
        else:
            course_type = []
    
    day = request.args.get('day', type=int)
    period = request.args.get('period', type=int)
    
    query = Course.query
    
    if semester:
        query = query.filter(Course.semester == semester)
    
    # course_id 筛选：列表=精确匹配任意一项，非列表=模糊匹配
    if search_id:
        if isinstance(search_id, list):
            query = query.filter(Course.course_id.in_(search_id))
        else:
            query = query.filter(Course.course_id.like(f"%{search_id}%"))
        
    # course_name 筛选：列表=精确匹配任意一项，非列表=模糊匹配
    if search_name:
        # 模糊匹配课程名
        mappings = CourseNameMapping.query.filter(
            CourseNameMapping.course_name.like(f"%{search_name}%")
        ).all()
        
        course_ids = [m.course_id for m in mappings]
        if course_ids:
            query = query.filter(Course.course_id.in_(course_ids))
        else:
            query = query.filter(False)
        
    # 院系筛选（支持单个值或列表）
    if department_code:
        query = query.filter(Course.department_code.in_(department_code))
        
    # 课程类型筛选（支持单个值或列表）
    if course_type:
        query = query.filter(Course.course_type.in_(course_type))
        
    if request.args.get('distinct_mode') == 'true':
        query = query.group_by(Course.course_id)
        
    # Time filtering
    if day is not None and period is not None:
        courses = query.all()
        filtered_courses = []
        for course in courses:
            if not course.class_times:
                continue
            match = False
            for time in course.class_times:
                if time['day'] == day and time['start_period'] <= period <= time['end_period']:
                    match = True
                    break
            if match:
                filtered_courses.append(course)
        
        total = len(filtered_courses)
        
        # per_page=0 时不分页
        if per_page == 0:
            paginated_items = filtered_courses
            pages = 1
        else:
            start = (page - 1) * per_page
            end = start + per_page
            paginated_items = filtered_courses[start:end]
            pages = (total + per_page - 1) // per_page
        
    else:
        # per_page=0 时不分页，返回所有课程
        if per_page == 0:
            paginated_items = query.all()
            total = len(paginated_items)
            pages = 1
        else:
            pagination = query.paginate(page=page, per_page=per_page, error_out=False)
            paginated_items = pagination.items
            total = pagination.total
            pages = pagination.pages
    
    return jsonify({
        'courses': [{
            'uuid': c.uuid,
            'course_id': c.course_id,
            'course_name': c.course_name,
            'course_type': c.course_type,
            'department_code': c.department_code,
            'class_number': c.class_number,
            'credits': c.credits,
            'semester': c.semester,
            'teachers': c.teachers,
            'class_times': c.class_times,
            'remarks': c.remarks
        } for c in paginated_items],
        'total': total,
        'pages': pages,
        'current_page': page
    })


@app.route('/api/courses/<course_uuid>', methods=['GET'])
@login_required
def get_course(course_uuid, current_user):
    """获取单个课程详情"""
    course = db.session.get(Course, course_uuid)
    if not course:
        return jsonify({'success': False, 'message': 'Course not found'}), 404
        
    return jsonify({
        'course': {
            'uuid': course.uuid,
            'course_id': course.course_id,
            'course_name': course.course_name,
            'course_type': course.course_type,
            'department_code': course.department_code,
            'class_number': course.class_number,
            'credits': course.credits,
            'semester': course.semester,
            'teachers': course.teachers,
            'class_times': course.class_times,
            'remarks': course.remarks
        }
    })


@app.route('/api/courses/batch', methods=['POST'])
@login_required
def get_courses_batch(current_user):
    """批量获取课程详情"""
    data = request.json
    uuids = data.get('uuids', [])
    
    if not uuids:
        return jsonify({'courses': []})
        
    courses = Course.query.filter(Course.uuid.in_(uuids)).all()
    
    return jsonify({
        'courses': [{
            'uuid': c.uuid,
            'course_id': c.course_id,
            'course_name': c.course_name,
            'course_type': c.course_type,
            'department_code': c.department_code,
            'class_number': c.class_number,
            'credits': c.credits,
            'semester': c.semester,
            'teachers': c.teachers,
            'class_times': c.class_times,
            'remarks': c.remarks
        } for c in courses]
    })


# ==================== 学生路由 ====================

@app.route('/api/student/selected', methods=['GET'])
@student_required
def get_student_selected_courses(current_user):
    """学生获取自己的已选课程"""
    semester = request.args.get('semester')
    
    # 构建查询
    query = SelectedCourse.query.filter_by(user_id=current_user.id)
    # 如果有学期参数，筛选该学期；否则查询所有学期
    if semester:
        query = query.filter_by(semester=semester)
    
    selected = query.all()
    
    course_uuids = []
    details = []
    
    for s in selected:
        if s.course_uuid:
            course_uuids.append(s.course_uuid)
            c = s.course
            if c:
                # 使用选课记录中的 class_times（包含地点），如果没有则使用课程库的
                # 只有当 class_times 为 None 时才使用课程库的 class_times
                # 空数组 [] 表示EX成绩清空的信息，应该保留
                class_times = s.class_times if s.class_times is not None else c.class_times
                details.append({
                    'id': s.id,
                    'course_uuid': s.course_uuid,
                    'course_id': c.course_id,
                    'course_name': c.course_name,
                    'class_times': class_times,
                    'credits': c.credits,
                    'teachers': c.teachers,
                    'department_code': c.department_code,
                    'course_type': c.course_type,
                    'class_number': c.class_number,
                    'exam_info': s.exam_info,  # 考试信息
                    'remarks': s.remarks,
                    'semester': s.semester,
                    'channel': s.channel
                })
            
    return jsonify({
        'selected_uuids': course_uuids,
        'selected_details': details
    })


@app.route('/api/student/selected', methods=['POST'])
@student_required
def student_select_course(current_user):
    """学生选课"""
    data = request.json
    semester = data.get('semester')
    course_uuid = data.get('course_uuid')
    channel = data.get('channel', 0)  # 0=主修，1=辅双，默认主修
    
    if not semester or not course_uuid:
        return jsonify({'success': False, 'message': 'Missing parameters'}), 400
    
    # 检查是否已选
    exists = SelectedCourse.query.filter_by(
        user_id=current_user.id,
        semester=semester, 
        course_uuid=course_uuid
    ).first()
    
    if exists:
        # 更新channel
        exists.channel = channel
        db.session.commit()
        return jsonify({'success': True, 'message': 'Already selected', 'id': exists.id})
        
    try:
        new_selection = SelectedCourse(
            user_id=current_user.id,
            semester=semester, 
            course_uuid=course_uuid,
            channel=channel
        )
        db.session.add(new_selection)
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Course selected', 'id': new_selection.id})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/student/selected', methods=['DELETE'])
@student_required
def student_unselect_course(current_user):
    """学生退课"""
    semester = request.args.get('semester')
    course_uuid = request.args.get('course_uuid')
    
    if not semester:
        return jsonify({'success': False, 'message': 'Semester required'}), 400
        
    try:
        if course_uuid:
            # 退选课程
            selected = SelectedCourse.query.filter_by(
                user_id=current_user.id,
                semester=semester, 
                course_uuid=course_uuid
            ).first()

            if selected:
                db.session.delete(selected)
            
            message = 'Course unselected'
            
        else:
            # 清空该学期所有课程
            selected_courses = SelectedCourse.query.filter_by(
                user_id=current_user.id,
                semester=semester
            ).all()
            
            for sc in selected_courses:
                db.session.delete(sc)
                    
            message = 'All courses unselected'
            
        db.session.commit()
        return jsonify({'success': True, 'message': message})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500

# ---- 成绩单管理 ----

def calculate_course_gpa(score, score_type):
    """根据百分制成绩计算课程绩点"""
    if score_type != 'Percentage':
        return None

    try:
        num_score = float(score)
        if num_score < 60:
            return 0.0
        if num_score >= 100:
            return 4.0
        # GPA = 4 - 3 * (100 - X)² / 1600
        gpa = 4 - 3 * (100 - num_score) ** 2 / 1600
        return round(gpa, 2)
    except (ValueError, TypeError):
        return None # 无法转换为数字，返回 None


@app.route('/api/student/transcript', methods=['GET'])
@student_required
def student_get_transcript(current_user):
    """学生获取成绩单（从数据库获取）"""
    try:
        # 1. 获取主修/辅双成绩单
        transcripts = Transcript.query.filter_by(user_id=current_user.id).all()
        
        # 按学年-学期分组
        grouped = {}
        
        for t in transcripts:
            key = f"{t.academic_year}-{t.term}"
            if key not in grouped:
                grouped[key] = {
                    'academic_year': t.academic_year,
                    'term': t.term,
                    'courses': [],
                    'exchange_courses': [],  # 转交流课程单独列表
                    'has_minor': False,  # 标记是否含辅双课程
                    'has_exchange': False  # 标记是否含转交流课程
                }
            
            # 根据 score 实时计算 GPA
            gpa = calculate_course_gpa(t.score, t.score_type)
            
            course_data = {
                'record_id': t.record_id,
                'uuid': t.uuid,
                'course_id': t.course_id,
                'class_number': t.class_number,
                'course_name': t.course_name,
                'score': t.score,
                'score_type': t.score_type,
                'credits': t.credits,
                'gpa': gpa,
                'channel': t.channel  # 0=主修，1=辅双
            }
            grouped[key]['courses'].append(course_data)
            
            # 检查是否含辅双课程
            if t.channel == 1:
                grouped[key]['has_minor'] = True
        
        # 2. 获取转交流成绩，按学期分组
        exchange_transcripts = ExchangeTranscript.query.filter_by(user_id=current_user.id).all()
        
        for et in exchange_transcripts:
            key = f"{et.academic_year}-{et.term}"
            if key not in grouped:
                # 如果该学期没有主修/辅双课程，创建新分组
                grouped[key] = {
                    'academic_year': et.academic_year,
                    'term': et.term,
                    'courses': [],
                    'exchange_courses': [],
                    'has_minor': False,
                    'has_exchange': False
                }
            
            # 转交流课程数据（channel=2，不计绩点，100%填充）
            exchange_data = {
                'id': et.id,
                'course_name': et.course_name,
                'score': et.score,
                'score_type': et.score_type,
                'credits': et.credits,
                'channel': 2,  # 转交流
                'conversion_type': et.conversion_type,
                'gpa': None  # 转交流不计绩点
            }
            grouped[key]['exchange_courses'].append(exchange_data)
            grouped[key]['has_exchange'] = True
        
        # 学期排序，降序
        result = []
        for key in sorted(grouped.keys(), reverse=True):
            result.append(grouped[key])
        
        # 3. 获取毕业论文
        dissertation = DissertationTranscript.query.filter_by(user_id=current_user.id).first()
        dissertation_data = None
        
        if dissertation:
            dissertation_gpa = calculate_course_gpa(dissertation.score, dissertation.score_type) if dissertation.complete else None
            
            dissertation_data = {
                'complete': dissertation.complete,
                'title': dissertation.title if dissertation.complete else None,
                'score': dissertation.score if dissertation.complete else None,
                'score_type': dissertation.score_type if dissertation.complete else None,
                'credits': dissertation.credits if dissertation.complete else None,
                'gpa': dissertation_gpa
            }
        
        return jsonify({
            'success': True,
            'transcripts': result,
            'dissertation': dissertation_data
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/student/schedule/pdf', methods=['POST'])
@student_required
def student_export_schedule_pdf(current_user):
    """
    导出课程表为PDF
    请求: {
        html: string,  # 包含课程表的HTML字符串
        semester: string,
        week: int,
        total_credits: float,
        course_count: int
    }
    返回: PDF文件
    """
    data = request.json or {}
    html_content = data.get('html', '')
    semester = data.get('semester', '')
    week = data.get('week', 1)
    total_credits = data.get('total_credits', 0)
    course_count = data.get('course_count', 0)
    
    if not html_content:
        return jsonify({'success': False, 'message': '缺少HTML内容'}), 400
    
    try:
        # 创建完整的HTML文档
        full_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>我的课表 - {semester}</title>
            <style>
                @page {{
                    size: A3;
                    margin: 10mm;
                }}
                * {{
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }}
                body {{
                    font-family: "Segoe UI", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
                    font-size: 12px;
                    line-height: 1.4;
                    color: #333;
                    background: white;
                }}
                .pdf-container {{
                    width: 100%;
                    padding: 10mm;
                }}
                .pdf-header {{
                    text-align: center;
                    margin-bottom: 15px;
                    border-bottom: 2px solid #0067c0;
                    padding-bottom: 10px;
                }}
                .pdf-title {{
                    font-size: 24px;
                    font-weight: bold;
                    color: #0067c0;
                    margin-bottom: 8px;
                }}
                .pdf-info {{
                    display: flex;
                    justify-content: center;
                    gap: 30px;
                    font-size: 14px;
                    color: #555;
                }}
                .pdf-info-item {{
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }}
                .pdf-info-label {{
                    font-weight: 600;
                }}
                .pdf-info-value {{
                    color: #0067c0;
                    font-weight: bold;
                }}
                .pdf-table-container {{
                    width: 100%;
                }}
                /* 课程表样式 */
                .course-table {{
                    width: 100%;
                    border-collapse: separate;
                    border-spacing: 0;
                    table-layout: fixed;
                    border-radius: 8px;
                    overflow: hidden;
                    border: 1px solid #e0e0e0;
                }}
                .course-table th, .course-table td {{
                    border-right: 1px solid #f0f0f0;
                    border-bottom: 1px solid #f0f0f0;
                    padding: 6px;
                    text-align: center;
                    vertical-align: top;
                }}
                .course-table th {{
                    background-color: #f8f9fa;
                    padding: 10px;
                    font-weight: 600;
                    color: #444;
                    border-bottom: 2px solid #e0e0e0;
                    font-size: 11px;
                }}
                .period-cell {{
                    background-color: #fafafa;
                    font-weight: 600;
                    color: #666;
                    vertical-align: middle;
                    width: 50px;
                    font-size: 10px;
                }}
                .time-cell {{
                    height: 70px;
                    position: relative;
                    font-size: 10px;
                }}
                /* 课程卡片样式 */
                .course-card {{
                    background-color: #e3f2fd;
                    border: 1px solid #90caf9;
                    border-radius: 4px;
                    padding: 4px;
                    margin: 2px;
                    font-size: 9px;
                    line-height: 1.3;
                }}
                .course-card.conflict {{
                    background-color: #ffebee;
                    border-color: #c62828;
                }}
                .course-name {{
                    font-weight: bold;
                    color: #1565c0;
                    margin-bottom: 2px;
                    font-size: 10px;
                }}
                .course-info {{
                    color: #555;
                    font-size: 9px;
                }}
                .exam-info {{
                    color: #e65100;
                    font-weight: bold;
                }}
                /* 确保打印背景色 */
                * {{
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }}
            </style>
        </head>
        <body>
            <div class="pdf-container">
                <div class="pdf-header">
                    <div class="pdf-title">我的课表</div>
                    <div class="pdf-info">
                        <div class="pdf-info-item">
                            <span class="pdf-info-label">学年学期：</span>
                            <span class="pdf-info-value">{semester}</span>
                        </div>
                        <div class="pdf-info-item">
                            <span class="pdf-info-label">第{week}周</span>
                        </div>
                        <div class="pdf-info-item">
                            <span class="pdf-info-label">总学分：</span>
                            <span class="pdf-info-value">{total_credits}</span>
                        </div>
                        <div class="pdf-info-item">
                            <span class="pdf-info-label">课程数：</span>
                            <span class="pdf-info-value">{course_count}</span>
                        </div>
                    </div>
                </div>
                <div class="pdf-table-container">
                    {html_content}
                </div>
            </div>
        </body>
        </html>
        """
        
        # 使用 Playwright 生成 PDF
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp_file:
            pdf_path = tmp_file.name
        
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.set_content(full_html)
            
            # 等待字体加载
            page.wait_for_timeout(1000)
            
            # 生成 PDF (A3 竖向)
            page.pdf(
                path=pdf_path,
                format='A3',
                margin={
                    'top': '5mm',
                    'right': '5mm',
                    'bottom': '5mm',
                    'left': '5mm'
                },
                print_background=True
            )
            
            browser.close()
        
        # 发送 PDF 文件
        response = send_file(
            pdf_path,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=f'课表_{semester}_第{week}周.pdf'
        )
        
        # 设置响应头，确保文件下载后删除临时文件
        @response.call_on_close
        def cleanup():
            try:
                os.remove(pdf_path)
            except:
                pass
        
        return response
        
    except Exception as e:
        import traceback
        print(f"PDF生成错误: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': f'PDF生成失败: {str(e)}'}), 500


@app.route('/api/student/schedule/sync', methods=['POST'])
@student_required
def student_sync_schedule(current_user):
    """同步课程表（使用学生登录时保存的Portal session自动获取）"""
    data = request.json or {}
    year = data.get('year')  # 如 "24-25"
    semester = data.get('semester')  # 如 "1", "2", "3"
    target_semester = data.get('target_semester')  # 如 "25-26-1"
    
    if not year or not semester or not target_semester:
        return jsonify({
            'success': False,
            'message': '缺少必要参数：year, semester, target_semester'
        }), 400
    
    # 获取Portal课程表
    success, result = get_student_schedule(current_user.id, year, semester)
    
    if not success:
        return jsonify({
            'success': False,
            'message': f'获取课程表失败: {result}'
        }), 500
    
    schedule_data = result.get('course', [])
    
    if not schedule_data:
        return jsonify({
            'success': False,
            'message': '没有课程表数据'
        }), 400
    
    try:
        updated_count = 0
        skipped_count = 0
        not_found_count = 0
        
        # 获取该学生的已选课程
        selected_courses = SelectedCourse.query.filter_by(
            user_id=current_user.id,
            semester=target_semester
        ).all()
        
        # 构建课程名称到选课记录的映射
        selected_map = {}
        
        for sc in selected_courses:
            course_name = sc.course.course_name
            if course_name:
                if course_name not in selected_map:
                    selected_map[course_name] = []
                selected_map[course_name].append(sc)
        
        # 获取成绩单，构建uuid到成绩和channel的映射
        transcripts = Transcript.query.filter_by(user_id=current_user.id).all()
        transcript_scores = {}  # uuid到成绩的映射
        transcript_channels = {}  # uuid到channel的映射
        
        for t in transcripts:
            transcript_scores[t.uuid] = t.score
            transcript_channels[t.uuid] = t.channel
        
        # 处理Portal返回的课程
        for portal_course in schedule_data:
            course_name = portal_course.get('course_name')
            portal_channel = portal_course.get('channel', 0)  # Portal返回的channel
            
            if not course_name:
                continue
            
            # 检查是否已选此课程
            if course_name not in selected_map:
                not_found_count += 1
                continue
            
            # 遍历匹配的选课记录
            for selected in selected_map[course_name]:
                # 获取选课记录的uuid
                selected_uuid = selected.course.uuid
                
                # 利用uuid检查成绩单
                score = transcript_scores.get(selected_uuid)
                
                # 如果成绩单中有非W成绩，跳过更新
                # 否则，覆盖channel和课程信息
                # 优先使用成绩单的channel，如果没有则使用Portal的channel
                if not score or score == 'W':
                    if selected_uuid in transcript_channels:
                        selected.channel = transcript_channels[selected_uuid]
                    else:
                        selected.channel = portal_channel
                
                # 如果成绩单中为EX，跳过上课、考试时间更新
                if score == 'EX':
                    skipped_count += 1
                    continue

                # 更新上课及考试时间
                selected.class_times = portal_course.get('class_times', [])
                
                # 更新exam_info
                exam_info = portal_course.get('exam', {})
                selected.exam_info = exam_info if exam_info else {}
                
                updated_count += 1
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': f'同步完成：更新 {updated_count} 条，跳过 {skipped_count} 条（EX成绩），未匹配 {not_found_count} 条',
            'updated_count': updated_count,
            'skipped_count': skipped_count,
            'not_found_count': not_found_count
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/student/transcript/sync', methods=['POST'])
@student_required
def student_sync_transcript(current_user):
    """同步成绩单（只同步到数据库，不自动选课）"""
    # 使用新的 get_student_scores 函数获取成绩单
    success, result = get_student_scores(current_user.id)
    
    if not success:
        return jsonify({
            'success': False, 
            'message': f'获取成绩单失败: {result}'
        }), 500
    
    student_type = result.get('student_type', 'unknown')
    if student_type == 'graduate':
        return jsonify({'success': False, 'message': '暂不支持研究生成绩单解析'}), 400
    
    # 获取主修、辅双、转交流和毕业论文成绩单
    major_scores = result.get('transcripts', [])
    minor_scores = result.get('minor_transcripts', [])
    exchange_scores = result.get('exchange_transcripts', [])
    dissertation_info = result.get('dissertation_transcripts', {})

    try:
        # 1. 清空主修/辅双成绩单
        Transcript.query.filter_by(user_id=current_user.id).delete()
        
        # 2. 清空转交流成绩单
        ExchangeTranscript.query.filter_by(user_id=current_user.id).delete()
        
        # 3. 处理毕业论文（更新或创建）
        dissertation = DissertationTranscript.query.filter_by(user_id=current_user.id).first()
        if dissertation_info and dissertation_info.get('complete'):
            # 已完成毕业论文
            if not dissertation:
                dissertation = DissertationTranscript(user_id=current_user.id)
            dissertation.complete = True
            dissertation.title = dissertation_info.get('title', '')
            dissertation.score = str(dissertation_info.get('score', ''))
            dissertation.score_type = dissertation_info.get('score_type', 'P/NP')
            dissertation.credits = float(dissertation_info.get('credits', 0))
            db.session.add(dissertation)
        elif dissertation_info:
            # 未完成毕业论文
            if not dissertation:
                dissertation = DissertationTranscript(user_id=current_user.id)
            dissertation.complete = False
            dissertation.title = None
            dissertation.score = None
            dissertation.score_type = None
            dissertation.credits = None
            db.session.add(dissertation)
        
        synced_count = 0
        error_messages = []
        
        # 4. 处理主修成绩 (channel=0)
        for term_data in major_scores:
            academic_year = term_data.get('year', '')
            term = int(term_data.get('semester', 1))
            courses = term_data.get('courses', [])
            
            for course in courses:
                try:
                    record_id = course.get('record_id')
                    uuid = course.get('uuid')
                    course_id = course.get('course_id')
                    class_number = course.get('class_number')
                    course_name = course.get('course_name')
                    score = str(course.get('score', ''))
                    score_type = course.get('score_type')
                    credits = float(course.get('credits', 0))
                    
                    if not record_id or not course_id:
                        continue
                    
                    transcript = Transcript(
                        record_id=record_id,
                        user_id=current_user.id,
                        uuid=uuid,
                        course_id=course_id,
                        class_number=class_number,
                        academic_year=academic_year,
                        term=term,
                        course_name=course_name,
                        score=score,
                        score_type=score_type,
                        credits=credits,
                        channel=0  # 主修
                    )
                    db.session.add(transcript)
                    synced_count += 1
                    
                except Exception as e:
                    error_messages.append(f"主修课程 {course.get('course_id', 'unknown')}: {str(e)}")
        
        # 5. 处理辅双成绩 (channel=1)
        for term_data in minor_scores:
            academic_year = term_data.get('year', '')
            term = int(term_data.get('semester', 1))
            courses = term_data.get('courses', [])
            
            for course in courses:
                try:
                    record_id = course.get('record_id')
                    uuid = course.get('uuid')
                    course_id = course.get('course_id')
                    class_number = course.get('class_number')
                    course_name = course.get('course_name')
                    score = str(course.get('score', ''))
                    score_type = course.get('score_type')
                    credits = float(course.get('credits', 0))
                    
                    if not record_id or not course_id:
                        continue
                    
                    transcript = Transcript(
                        record_id=record_id,
                        user_id=current_user.id,
                        uuid=uuid,
                        course_id=course_id,
                        class_number=class_number,
                        academic_year=academic_year,
                        term=term,
                        course_name=course_name,
                        score=score,
                        score_type=score_type,
                        credits=credits,
                        channel=1  # 辅双
                    )
                    db.session.add(transcript)
                    synced_count += 1
                    
                except Exception as e:
                    error_messages.append(f"辅双课程 {course.get('course_id', 'unknown')}: {str(e)}")
        
        # 6. 处理转交流成绩 (channel=2)
        for term_data in exchange_scores:
            academic_year = term_data.get('year', '')
            term = int(term_data.get('semester', 1))
            courses = term_data.get('courses', [])
            
            for course in courses:
                try:
                    course_name = course.get('course_name', '')
                    score = str(course.get('score', ''))
                    credits = float(course.get('credits', 0))
                    conversion_type = course.get('conversion_type', '')
                    
                    if not course_name:
                        continue
                    
                    exchange = ExchangeTranscript(
                        user_id=current_user.id,
                        academic_year=academic_year,
                        term=term,
                        course_name=course_name,
                        score=score,
                        score_type=course.get('score_type', 'P/NP'),
                        credits=credits,
                        channel=2,  # 转交流
                        conversion_type=conversion_type
                    )
                    db.session.add(exchange)
                    synced_count += 1
                    
                except Exception as e:
                    error_messages.append(f"转交流课程 {course.get('course_name', 'unknown')}: {str(e)}")
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': f'成功同步 {synced_count} 条成绩记录',
            'errors': error_messages if error_messages else None
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/student/transcript/auto-select', methods=['POST'])
@student_required
def student_transcript_auto_select(current_user):
    """根据成绩单自动选课（只根据uuid匹配，使用课程库的学期，使用成绩单channel）"""
    try:
        # 1. 获取该学生的所有成绩单记录，提取所有uuid（排除W成绩）
        transcripts = Transcript.query.filter_by(user_id=current_user.id).all()
        
        # 收集所有成绩单中的uuid和channel（排除W成绩）
        transcript_uuids = set()
        transcript_scores = {}  # 记录每个uuid对应的成绩
        transcript_channels = {}  # 记录每个uuid对应的channel（0=主修，1=辅双）
        
        for t in transcripts:
            if t.score == 'W':
                continue
            transcript_uuids.add(t.uuid)
            transcript_scores[t.uuid] = t.score
            transcript_channels[t.uuid] = t.channel  # 0=主修，1=辅双
        
        auto_selected_uuids = []  # 自动选课的UUID列表
        skipped_count = 0  # 跳过的课程数（已选）
        not_found_count = 0  # 课程库中不存在的课程数
        
        # 2. 对于每个uuid，在课程库中查找
        for uuid in transcript_uuids:
            # 查找课程库中是否包含该uuid
            sys_course = Course.query.filter_by(uuid=uuid).first()
            
            if not sys_course:
                not_found_count += 1
                continue
            
            # 3. 检查是否已选（该课程已在任何学期被选中）
            # 使用 with_for_update 防止并发问题
            existing_selection = SelectedCourse.query.filter_by(
                user_id=current_user.id,
                course_uuid=sys_course.uuid
            ).with_for_update().first()
            
            if existing_selection:
                # 已选，用成绩单channel覆盖，检查是否为EX成绩
                existing_selection.channel = transcript_channels.get(uuid, 0)  # 默认主修
                if transcript_scores.get(uuid) == 'EX':
                    existing_selection.class_times = []
                    existing_selection.exam_info = {}
                skipped_count += 1
                continue
            
            # 4. 再次检查，防止并发（双重检查锁定模式）
            double_check = SelectedCourse.query.filter_by(
                user_id=current_user.id,
                course_uuid=sys_course.uuid
            ).first()
            
            if double_check:
                # 并发情况下已被其他请求选中
                double_check.channel = transcript_channels.get(uuid, 0)
                if transcript_scores.get(uuid) == 'EX':
                    double_check.class_times = []
                    double_check.exam_info = {}
                skipped_count += 1
                continue
            
            # 5. 自动选课到课程库中的学期
            course_semester = sys_course.semester
            if not course_semester:
                not_found_count += 1
                continue
            
            # 使用成绩单的channel（0=主修，1=辅双）
            channel = transcript_channels.get(uuid, 0)
            
            try:
                new_selection = SelectedCourse(
                    user_id=current_user.id,
                    semester=course_semester,
                    course_uuid=sys_course.uuid,
                    channel=channel  # 使用成绩单的channel
                )
                db.session.add(new_selection)
                db.session.flush()
            except Exception as e:
                # 如果插入失败（如唯一约束冲突），跳过
                db.session.rollback()
                skipped_count += 1
                continue
            
            # 5. 如果是EX成绩，清空上课和考试信息
            if transcript_scores.get(uuid) == 'EX':
                new_selection.class_times = []
                new_selection.exam_info = {}
            
            auto_selected_uuids.append(sys_course.uuid)
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': f'自动选课完成：新增 {len(auto_selected_uuids)} 门，跳过 {skipped_count} 门，未找到 {not_found_count} 门',
            'auto_selected_uuids': auto_selected_uuids,
            'auto_selected_count': len(auto_selected_uuids),
            'skipped_count': skipped_count,
            'not_found_count': not_found_count
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


# ==================== 管理员路由 ====================

@app.route('/api/admin/check-setup', methods=['GET'])
def admin_check_setup():
    """检查是否需要初始化管理员账号"""
    existing_admin = User.query.filter_by(role='admin').first()
    if existing_admin:
        return jsonify({
            'success': True,
            'adminExists': True,
            'username': existing_admin.username
        })
    return jsonify({
        'success': True,
        'adminExists': False
    })

@app.route('/api/admin/setup', methods=['POST'])
def admin_setup():
    """初始化管理员账号（仅首次使用）"""
    # 检查是否已有管理员
    existing_admin = User.query.filter_by(role='admin').first()
    if existing_admin:
        return jsonify({'success': False, 'message': '管理员账号已存在'}), 400

    data = request.json or {}
    username = data.get('username', 'admin')
    password = data.get('password')

    if not password or len(password) < 6:
        return jsonify({'success': False, 'message': '密码至少需要6位'}), 400

    # 使用bcrypt加密密码
    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    # 创建管理员
    user = create_admin_user(username, password_hash)

    return jsonify({
        'success': True,
        'message': '管理员账号创建成功',
        'username': user.username
    })


# ---- 课程管理 ----

@app.route('/api/admin/courses/import', methods=['POST'])
@admin_required
def admin_import_courses(current_user):
    """管理员导入课程"""
    # Check if file is present in request
    if 'file' in request.files:
        file = request.files['file']
        if file.filename == '':
            return jsonify({"success": False, "message": "No selected file"}), 400
            
        # Save temporarily
        import tempfile
        temp_fd, temp_path = tempfile.mkstemp()
        try:
            os.close(temp_fd)
            file.save(temp_path)
            success, message = import_courses_from_json(temp_path)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
        if success:
            return jsonify({"success": True, "message": message})
        else:
            return jsonify({"success": False, "message": message}), 500
            
    # Fallback to file_path for backward compatibility
    data = request.json or {}
    file_path = data.get('file_path')
    
    if not file_path:
        return jsonify({"success": False, "message": "No file or file path provided"}), 400
        
    if not os.path.exists(file_path):
        return jsonify({"success": False, "message": "File not found"}), 404
        
    success, message = import_courses_from_json(file_path)
    
    if success:
        return jsonify({"success": True, "message": message})
    else:
        return jsonify({"success": False, "message": message}), 500


@app.route('/api/admin/courses', methods=['POST'])
@admin_required
def admin_create_course(current_user):
    """管理员创建课程"""
    data = request.json
    try:
        # Basic validation
        if not data.get('course_id') or not data.get('course_name'):
            return jsonify({'success': False, 'message': 'Missing required fields'}), 400
            
        import uuid
        new_uuid = data.get('uuid') or f"MANUAL_{uuid.uuid4().hex[:8]}"
        
        # 创建或更新课程名称映射
        mapping = CourseNameMapping.query.filter_by(course_id=data['course_id']).first()
        if not mapping:
            mapping = CourseNameMapping(
                course_id=data['course_id'],
                course_name=data['course_name'],
                credits=float(data.get('credits', 0))
            )
            db.session.add(mapping)
        else:
            mapping.course_name = data['course_name']
            mapping.credits = float(data.get('credits', mapping.credits))
        
        new_course = Course(
            uuid=new_uuid,
            course_id=data['course_id'],
            course_type=data.get('course_type', ''),
            department_code=data.get('department_code', ''),
            class_number=data.get('class_number', ''),
            semester=data.get('semester', ''),
            class_times=data.get('class_times', []),  # 包含 week_range 和 location
            teachers=data.get('teachers', []),
            remarks=data.get('remarks', '')
        )
        db.session.add(new_course)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Course created', 'uuid': new_uuid})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/admin/courses/<course_uuid>', methods=['PUT'])
@admin_required
def admin_update_course(course_uuid, current_user):
    """管理员编辑课程"""
    data = request.json
    course = db.session.get(Course, course_uuid)
    if not course:
        return jsonify({'success': False, 'message': 'Course not found'}), 404
        
    try:
        # 如果课程号或课程名称变更，更新映射
        new_course_id = data.get('course_id', course.course_id)
        new_course_name = data.get('course_name')
        
        if new_course_name or (new_course_id and new_course_id != course.course_id):
            # 删除旧映射（如果不再有其他课程使用）
            old_mapping = CourseNameMapping.query.filter_by(course_id=course.course_id).first()
            if old_mapping and new_course_id != course.course_id:
                other_courses = Course.query.filter(
                    Course.course_id == course.course_id,
                    Course.uuid != course_uuid
                ).count()
                if other_courses == 0:
                    db.session.delete(old_mapping)
            
            # 创建或更新新映射
            mapping = CourseNameMapping.query.filter_by(course_id=new_course_id).first()
            if not mapping:
                mapping = CourseNameMapping(
                    course_id=new_course_id,
                    course_name=new_course_name or old_mapping.course_name if old_mapping else '未知课程'
                )
                db.session.add(mapping)
            elif new_course_name:
                mapping.course_name = new_course_name
        
        course.course_id = new_course_id
        course.course_type = data.get('course_type', course.course_type)
        course.department_code = data.get('department_code', course.department_code)
        course.class_number = data.get('class_number', course.class_number)
        course.credits = float(data.get('credits', course.credits))
        course.semester = data.get('semester', course.semester)
        course.class_times = data.get('class_times', course.class_times)
        course.teachers = data.get('teachers', course.teachers)
        course.remarks = data.get('remarks', course.remarks)
        
        db.session.commit()
        return jsonify({'success': True, 'message': 'Course updated'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/admin/courses/<course_uuid>', methods=['DELETE'])
@admin_required
def admin_delete_course(course_uuid, current_user):
    """管理员删除课程"""
    course = db.session.get(Course, course_uuid)
    if not course:
        return jsonify({'success': False, 'message': 'Course not found'}), 404
        
    try:
        # Also delete from selected courses
        SelectedCourse.query.filter_by(course_uuid=course_uuid).delete()
        db.session.delete(course)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Course deleted'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/admin/courses/clear', methods=['DELETE'])
@admin_required
def admin_clear_all_courses(current_user):
    """管理员清空某学期课程"""
    semester = request.args.get('semester')
    if not semester:
        return jsonify({'success': False, 'message': '请指定学期'}), 400
    
    try:
        # Delete courses for the specified semester
        courses = Course.query.filter_by(semester=semester).all()
        for c in courses:
            SelectedCourse.query.filter_by(course_uuid=c.uuid).delete()
            db.session.delete(c)
        
        db.session.commit()
        return jsonify({'success': True, 'message': f'{semester}学期的课程已清空'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500



# 注：培养方案管理 API 已迁移到 program_api.py
# 新 API 路径：
#   GET    /api/admin/programs
#   POST   /api/admin/programs
#   GET    /api/admin/programs/{id}
#   PUT    /api/admin/programs/{id}
#   DELETE /api/admin/programs/{id}
#   GET    /api/admin/programs/{id}/categories
#   POST   /api/admin/programs/{id}/categories
#   GET    /api/admin/categories/{id}/nodes
#   POST   /api/admin/categories/{id}/nodes
#   PUT    /api/admin/nodes/{id}
#   DELETE /api/admin/nodes/{id}
#   POST   /api/admin/nodes/{id}/course-lists
#   PUT    /api/admin/course-lists/{id}
#   DELETE /api/admin/course-lists/{id}


# ---- 学生管理 ----

@app.route('/api/admin/students', methods=['GET'])
@admin_required
def admin_get_students(current_user):
    """获取所有学生"""
    students = User.query.filter_by(role='student').order_by(User.created_at.desc()).all()
    
    # 获取培养方案名称映射（新系统：主修+辅双）
    program_ids = []
    for s in students:
        if s.major_program_id:
            program_ids.append(s.major_program_id)
        if s.minor_program_id:
            program_ids.append(s.minor_program_id)
    
    programs = Program.query.filter(Program.id.in_(program_ids)).all() if program_ids else []
    program_map = {p.id: p.name for p in programs}
    
    return jsonify({
        'success': True,
        'students': [{
            'id': s.id,
            'username': s.username,
            'name': s.name,
            'major_program_id': s.major_program_id,
            'major_program_name': program_map.get(s.major_program_id),
            'minor_program_id': s.minor_program_id,
            'minor_program_name': program_map.get(s.minor_program_id),
            'last_login': s.last_login.isoformat() if s.last_login else None,
            'created_at': s.created_at.isoformat() if s.created_at else None
        } for s in students]
    })


# 注：为学生分配培养方案 API 已迁移到 program_api.py
# 新 API 路径：POST /api/admin/users/{user_id}/assign-programs
# 支持同时分配主修和辅双方案：
# {
#   "major_program_id": 1,
#   "minor_program_id": 2
# }


@app.route('/api/admin/students/<int:student_id>/courses', methods=['GET'])
@admin_required
def admin_get_student_courses(student_id, current_user):
    """查看学生的选课"""
    student = User.query.filter_by(id=student_id, role='student').first()
    if not student:
        return jsonify({'success': False, 'message': '学生不存在'}), 404
    
    semester = request.args.get('semester', '')
    
    query = SelectedCourse.query.filter_by(user_id=student_id)
    if semester:
        query = query.filter_by(semester=semester)
    
    selected = query.all()
    
    result = []
    for s in selected:
        if s.course:
            result.append({
                'id': s.id,
                'type': 'standard',
                'course_id': s.course.course_id,
                'course_name': s.course.course_name,
                'credits': s.course.credits,
                'semester': s.semester,
                'class_number': s.course.class_number
            })
    
    return jsonify({
        'success': True,
        'student_id': student_id,
        'student_name': student.name,
        'courses': result
    })


# ==================== 静态文件服务 ====================

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    with app.app_context():
        db.create_all()

    if _is_compiled:
        app.run(host='127.0.0.1', port=5000, debug=False)
    else:
        app.run(host='127.0.0.1', port=5001, debug=True)
