"""
认证工具模块 - 处理北大IAAA认证和JWT
"""
import os
import uuid
import time
import secrets
import base64
import jwt
from datetime import datetime, timedelta
from functools import wraps
from flask import request, jsonify, current_app
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_v1_5

# Import new client
from client import Portal2017LoginClient, LoginMethod, LoginReqs, PKUIAAAError
from publicQuery import get_scores, get_schedule
from models import User, db

# JWT配置
def _load_jwt_secret():
    """加载JWT密钥：首次运行时生成随机密钥并持久化到文件"""
    secret_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.jwt_secret')
    if os.path.exists(secret_file):
        with open(secret_file, 'r') as f:
            return f.read().strip()
    secret = secrets.token_hex(32)
    with open(secret_file, 'w') as f:
        f.write(secret)
    return secret

JWT_SECRET = _load_jwt_secret()
JWT_EXPIRE_HOURS = 24
LOCAL_USERNAME = 'local'
LOCAL_DISPLAY_NAME = '本地用户'

# 临时登录会话存储（登录过程中使用）
# {session_id: {
#     'client': Portal2017LoginClient,
#     'rsa_key': {'private': key, 'public': key, 'key_id': str},  # 前端加密用RSA密钥对
#     'created_at': datetime,
#     'username': str
# }}
_login_sessions = {}

# ========== 速率限制 ==========

_rate_limit_store = {}  # {key: [timestamp, ...]}

def rate_limit(max_attempts=5, window_seconds=60):
    """
    简单的速率限制装饰器
    基于客户端IP+端点进行限制
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # 获取客户端标识（IP + 端点路径）
            client_ip = request.remote_addr or 'unknown'
            endpoint = request.path
            key = f"{client_ip}:{endpoint}"

            now = datetime.now()
            if key in _rate_limit_store:
                # 清理过期记录
                cutoff = now - timedelta(seconds=window_seconds)
                _rate_limit_store[key] = [t for t in _rate_limit_store[key] if t > cutoff]

                if len(_rate_limit_store[key]) >= max_attempts:
                    return jsonify({
                        'success': False,
                        'message': f'请求过于频繁，请{window_seconds}秒后再试'
                    }), 429

            if key not in _rate_limit_store:
                _rate_limit_store[key] = []
            _rate_limit_store[key].append(now)

            return f(*args, **kwargs)
        return decorated_function
    return decorator

# Portal会话存储（登录成功后使用）
# {user_id: {'client': Portal2017LoginClient, 'timestamp': datetime}}
_portal_sessions = {}


def _generate_session_id():
    """生成唯一会话ID"""
    return str(uuid.uuid4())


def _generate_rsa_keypair():
    """生成RSA密钥对 (SPKI格式公钥，与Web Crypto API兼容)"""
    key = RSA.generate(2048)
    private_key = key.export_key().decode('utf-8')
    # 使用 pkcs=8 生成 SPKI 格式公钥 (-----BEGIN PUBLIC KEY-----)
    public_key = key.publickey().export_key(format='PEM', pkcs=8).decode('utf-8')
    return private_key, public_key


def _decrypt_password(encrypted_password, private_key):
    """使用私钥解密密码 (RSA-OAEP with SHA-256，与Web Crypto API兼容)"""
    try:
        from Crypto.Cipher import PKCS1_OAEP
        from Crypto.Hash import SHA256
        
        rsa_key = RSA.import_key(private_key)
        cipher = PKCS1_OAEP.new(rsa_key, hashAlgo=SHA256)
        decrypted = cipher.decrypt(base64.b64decode(encrypted_password))
        return decrypted.decode('utf-8')
    except Exception as e:
        print(f"解密失败: {str(e)}")
        return None


def _cleanup_expired_sessions():
    """清理过期会话（30分钟未使用）"""
    now = datetime.now()
    expired_sessions = []
    for sid, data in _login_sessions.items():
        if now - data['created_at'] > timedelta(minutes=30):
            expired_sessions.append(sid)
    for sid in expired_sessions:
        del _login_sessions[sid]


def get_login_session(session_id):
    """获取登录会话"""
    _cleanup_expired_sessions()
    return _login_sessions.get(session_id)


def create_login_session(method='password'):
    """
    创建新的登录会话，生成RSA密钥对用于前端加密密码
    
    :param method: 'password' 或 'qr'
    :return: (session_id, key_info) 或 (None, None)
    """
    _cleanup_expired_sessions()
    
    session_id = _generate_session_id()
    login_method = LoginMethod.PASSWORD if method == 'password' else LoginMethod.QR
    
    try:
        client = Portal2017LoginClient(method=login_method)
        
        # 为密码登录生成RSA密钥对
        rsa_key = None
        if method == 'password':
            private_key, public_key = _generate_rsa_keypair()
            rsa_key = {
                'private': private_key,
                'public': public_key,
                'key_id': str(uuid.uuid4())[:8]
            }
        
        _login_sessions[session_id] = {
            'client': client,
            'rsa_key': rsa_key,
            'created_at': datetime.now(),
            'username': None
        }
        
        # 返回会话ID和公钥信息
        key_info = None
        if rsa_key:
            key_info = {
                'key_id': rsa_key['key_id'],
                'public_key': rsa_key['public']
            }
        
        return session_id, key_info
    except PKUIAAAError as e:
        return None, None


def get_session_public_key(session_id):
    """
    获取会话的RSA公钥
    
    :return: (success, public_key_or_error)
    """
    session = get_login_session(session_id)
    if not session:
        return False, "会话已过期或不存在"
    
    rsa_key = session.get('rsa_key')
    if not rsa_key:
        return False, "当前登录方式不需要密码加密"
    
    return True, {
        'key_id': rsa_key['key_id'],
        'public_key': rsa_key['public']
    }


def decrypt_session_password(session_id, encrypted_password):
    """
    解密会话中的密码
    
    :return: (success, password_or_error)
    """
    session = get_login_session(session_id)
    if not session:
        return False, "会话已过期或不存在"
    
    rsa_key = session.get('rsa_key')
    if not rsa_key:
        return False, "未找到RSA密钥"
    
    password = _decrypt_password(encrypted_password, rsa_key['private'])
    if not password:
        return False, "密码解密失败"
    
    return True, password


def switch_login_method(session_id, new_method):
    """
    切换登录方式
    
    :param session_id: 会话ID
    :param new_method: 'password' 或 'qr'
    :return: (success, error_message)
    """
    session = get_login_session(session_id)
    if not session:
        return False, "会话已过期或不存在"
    
    login_method = LoginMethod.PASSWORD if new_method == 'password' else LoginMethod.QR
    try:
        session['client'].switch_method(login_method)
        session['username'] = None  # 清除用户名
        return True, None
    except PKUIAAAError as e:
        return False, str(e)


def check_mobile_auth(session_id, username):
    """
    检查手机号认证需求
    
    :param session_id: 会话ID
    :param username: 用户名
    :return: (success, result_or_error)
    """
    session = get_login_session(session_id)
    if not session:
        return False, "会话已过期或不存在"
    
    try:
        result = session['client'].chk_mobile_auth(username)
        
        # 验证 chk_mobile_auth 返回的结果
        if result and isinstance(result, dict):
            # 检查是否有错误（如 E07 验证失败）
            if not result.get('success', True):
                error_code = result.get('errors', {}).get('code', 'UNKNOWN')
                error_msg = result.get('errors', {}).get('msg', '验证失败')
                return False, f"[{error_code}] {error_msg}"
        
        # 验证成功，保存用户名
        session['username'] = username
        
        mobile_mask = result.get('mobileMask', '')
        
        # 构建返回信息（确保返回布尔值而不是数字）
        auth_info = {
            'requires_captcha': bool(session['client'].auth_reqs.value & LoginReqs.CAPTCHA.value),
            'requires_sms': bool(session['client'].auth_reqs.value & LoginReqs.SMS.value),
            'requires_otp': bool(session['client'].auth_reqs.value & LoginReqs.OTP.value),
            'requires_bind_otp': bool(session['client'].auth_reqs.value & LoginReqs.BIND_OTP.value),
            'mobile_mask': mobile_mask
        }
        return True, auth_info
    except PKUIAAAError as e:
        return False, str(e)
    except Exception as e:
        return False, f"检查认证需求失败: {str(e)}"


def get_captcha_image(session_id):
    """
    获取验证码图片
    
    :return: (success, base64_image_or_error)
    """
    session = get_login_session(session_id)
    if not session:
        return False, "会话已过期或不存在"
    
    try:
        captcha_b64 = session['client'].get_captcha()
        return True, captcha_b64
    except PKUIAAAError as e:
        return False, str(e)


def send_sms_code(session_id):
    """
    发送短信验证码
    
    :return: (success, result_or_error)
    """
    session = get_login_session(session_id)
    if not session:
        return False, "会话已过期或不存在"
    
    if not session['username']:
        return False, "请先输入用户名"
    
    try:
        result = session['client'].send_sms_code(session['username'])
        return True, result
    except PKUIAAAError as e:
        return False, str(e)


def get_qr_image(session_id, username=None):
    """
    获取二维码图片
    
    :return: (success, base64_image_or_error)
    """
    session = get_login_session(session_id)
    if not session:
        return False, "会话已过期或不存在"
    
    try:
        qr_b64 = session['client'].get_QR(username)
        return True, qr_b64
    except PKUIAAAError as e:
        return False, str(e)


def password_login(session_id, password, captcha='', sms_code='', otp_code=''):
    """
    执行密码登录
    
    :return: (success, result_or_error, user_info)
    """
    session = get_login_session(session_id)
    if not session:
        return False, "会话已过期或不存在", None
    
    if not session['username']:
        return False, "请先输入用户名", None
    
    try:
        result = session['client'].password_login(
            username=session['username'],
            password=password,
            captcha=captcha,
            sms_code=sms_code,
            otp_code=otp_code
        )
        
        if result.get('success'):
            # 登录成功，使用 chk_login_status 获取真实学号和姓名
            try:
                login_status = session['client'].chk_login_status()
                if login_status.get('success'):
                    # 从登录状态中获取真实学号和姓名
                    real_username = login_status.get('userId') or session['username']
                    real_name = login_status.get('userName')
                    
                    user_info = {
                        'username': real_username,
                        'name': real_name,
                        'role': 'student'
                    }
                    # 更新session中的用户名
                    session['username'] = real_username
                    return True, result, user_info
                else:
                    # chk_login_status 失败，使用登录时的用户名
                    user_info = {
                        'username': session['username'],
                        'name': None,
                        'role': 'student'
                    }
                    return True, result, user_info
            except Exception as e:
                # chk_login_status 异常，使用登录时的用户名
                user_info = {
                    'username': session['username'],
                    'name': None,
                    'role': 'student'
                }
                return True, result, user_info
        else:
            # 登录失败，返回错误信息
            error_code = result.get('errors', {}).get('code', 'UNKNOWN')
            error_msg = result.get('errors', {}).get('msg', '登录失败')
            return False, f"[{error_code}] {error_msg}", None
            
    except PKUIAAAError as e:
        return False, str(e), None


def poll_qr_login(session_id):
    """
    轮询二维码登录状态
    
    :return: (success, result_or_error, user_info)
    """
    session = get_login_session(session_id)
    if not session:
        return False, "会话已过期或不存在", None
    
    try:
        result = session['client'].poll_qr_login()
        
        if result.get('success'):
            # 登录成功，通过 chk_login_status 获取用户信息
            try:
                login_status = session['client'].chk_login_status()
                if login_status.get('success'):
                    # 从登录状态中获取用户名
                    username = login_status.get('userId')
                    
                    user_info = {
                        'username': username or 'unknown',
                        'name': login_status.get('userName'),
                        'role': 'student'
                    }
                    return True, result, user_info
                else:
                    # 获取登录状态失败，使用session中的用户名
                    username = session.get('username') or 'unknown'
                    user_info = {
                        'username': username,
                        'name': None,
                        'role': 'student'
                    }
                    return True, result, user_info
            except Exception as e:
                # 获取登录状态失败，使用session中的用户名
                username = session.get('username') or 'unknown'
                user_info = {
                    'username': username,
                    'name': None,
                    'role': 'student'
                }
                return True, result, user_info
        else:
            # 未成功，返回状态
            error_code = result.get('errors', {}).get('code', '')
            error_msg = result.get('errors', {}).get('msg', '')
            is_stop = result.get('isStop') == '是'
            
            # E10 是正常等待状态，不是错误
            if error_code == 'E10':
                return True, {'status': 'waiting', 'message': '等待扫码', 'is_stop': False}, None
            
            # 需要停止的错误
            if is_stop or error_code == 'E99':
                return False, f"[{error_code}] {error_msg}", None
            
            # 其他错误但继续轮询（E02, E06等）
            return True, {'status': 'error', 'error_code': error_code, 'message': error_msg, 'is_stop': is_stop}, None
            
    except PKUIAAAError as e:
        return False, str(e), None


def finalize_login(session_id, user_info):
    """
    完成登录流程，保存portal会话，清理临时会话
    
    :param session_id: 临时会话ID
    :param user_info: 用户信息
    :return: (user, portal_client)
    """
    session = get_login_session(session_id)
    if not session:
        return None, None
    
    # 创建或更新用户
    user = create_or_update_student(
        username=user_info['username'],
        name=user_info.get('name')
    )
    
    # 保存portal会话
    _portal_sessions[user.id] = {
        'client': session['client'],
        'timestamp': datetime.now()
    }
    
    # 清理临时会话
    if session_id in _login_sessions:
        del _login_sessions[session_id]
    
    return user, session['client']


def bind_portal_session(session_id, user):
    """Bind a completed PKU Portal login session to the local app user."""
    session = get_login_session(session_id)
    if not session or not user:
        return False

    _portal_sessions[user.id] = {
        'client': session['client'],
        'timestamp': datetime.now()
    }

    if session_id in _login_sessions:
        del _login_sessions[session_id]

    return True


def get_portal_session(user_id):
    """获取用户的portal会话"""
    session_data = _portal_sessions.get(user_id)
    if not session_data:
        return None
    
    # 检查是否过期（4小时）
    if datetime.now() - session_data['timestamp'] > timedelta(hours=4):
        del _portal_sessions[user_id]
        return None
    
    return session_data['client']


def check_portal_login_status(user_id):
    """
    检查用户的portal登录状态
    
    :return: (is_valid, message)
    """
    client = get_portal_session(user_id)
    if not client:
        return False, "Portal会话已过期"
    
    try:
        result = client.chk_login_status()
        if result.get('success'):
            return True, "登录状态有效"
        else:
            # 会话失效，清除存储
            if user_id in _portal_sessions:
                del _portal_sessions[user_id]
            return False, "Portal会话已失效"
    except PKUIAAAError as e:
        return False, str(e)






def get_student_scores(user_id):
    """
    使用portal会话获取学生成绩单
    
    :param user_id: 用户ID
    :return: (success, scores_data_or_error)
    """
    client = get_portal_session(user_id)
    if not client:
        return False, "Portal会话已过期，请重新登录"
    
    try:
        scores = get_scores(client)
        return True, scores
    except Exception as e:
        return False, str(e)


def get_student_schedule(user_id, year, semester):
    """
    使用portal会话获取学生课程表
    
    :param user_id: 用户ID
    :param year: 学年，如 "24-25"
    :param semester: 学期，如 "1", "2", "3"
    :return: (success, schedule_data_or_error)
    """
    client = get_portal_session(user_id)
    if not client:
        return False, "Portal会话已过期，请重新登录"
    
    try:
        schedule = get_schedule(client, year, semester)
        return True, schedule
    except Exception as e:
        return False, str(e)


def clear_portal_session(user_id):
    """清除用户的portal会话"""
    if user_id in _portal_sessions:
        del _portal_sessions[user_id]


# ========== JWT 相关函数 ==========

def generate_jwt_token(user):
    """生成JWT Token"""
    payload = {
        'user_id': user.id,
        'username': user.username,
        'role': user.role,
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS),
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')


def decode_jwt_token(token):
    """解码JWT Token"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_current_user():
    """从请求中获取当前用户"""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return None
    
    try:
        token = auth_header.replace('Bearer ', '').strip()
        payload = decode_jwt_token(token)
        if not payload:
            return None
        
        user = User.query.get(payload.get('user_id'))
        return user
    except:
        return None


def login_required(f):
    """登录验证装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'success': False, 'message': '请先登录'}), 401
        kwargs['current_user'] = user
        return f(*args, **kwargs)
    return decorated_function


def student_required(f):
    return login_required(f)
    """学生权限装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'success': False, 'message': '请先登录'}), 401
        if user.role != 'student':
            return jsonify({'success': False, 'message': '需要学生权限'}), 403
        kwargs['current_user'] = user
        return f(*args, **kwargs)
    return decorated_function


def admin_required(f):
    return login_required(f)
    """管理员权限装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'success': False, 'message': '请先登录'}), 401
        if user.role != 'admin':
            return jsonify({'success': False, 'message': '需要管理员权限'}), 403
        kwargs['current_user'] = user
        return f(*args, **kwargs)
    return decorated_function


# ========== 用户管理函数 ==========

def get_or_create_local_user():
    """Return the single local application user, creating it for a fresh DB."""
    user = User.query.filter_by(username=LOCAL_USERNAME).first()
    if user:
        user.role = 'local'
        if not user.name:
            user.name = LOCAL_DISPLAY_NAME
        user.last_login = datetime.utcnow()
        db.session.commit()
        return user

    user = User(
        username=LOCAL_USERNAME,
        role='local',
        name=LOCAL_DISPLAY_NAME,
        last_login=datetime.utcnow()
    )
    db.session.add(user)
    db.session.commit()
    return user


def create_or_update_student(username, name=None):
    """创建或更新学生账号"""
    user = User.query.filter_by(username=username).first()
    
    if user:
        if name and not user.name:
            user.name = name
        user.last_login = datetime.utcnow()
    else:
        user = User(
            username=username,
            role='student',
            name=name,
            last_login=datetime.utcnow()
        )
        db.session.add(user)
    
    db.session.commit()
    return user


def create_admin_user(username, password_hash):
    """创建管理员账号"""
    user = User.query.filter_by(username=username).first()
    if user:
        user.password_hash = password_hash
        user.role = 'admin'
        if not user.name:
            user.name = '管理员'
    else:
        user = User(
            username=username,
            password_hash=password_hash,
            role='admin',
            name='管理员',
            last_login=datetime.utcnow()
        )
        db.session.add(user)
    
    db.session.commit()
    return user


# ========== 旧函数兼容（保留用于其他用途） ==========

def verify_pku_credentials(username, password):
    """
    兼容旧接口的验证函数
    返回: (success, user_info, cookie_str)
    """
    # 创建临时会话来验证
    session_id = create_login_session('password')
    if not session_id:
        return False, "无法创建登录会话", None
    
    # 检查认证需求
    success, result = check_mobile_auth(session_id, username)
    if not success:
        return False, result, None
    
    # 获取验证码如果需要
    captcha = ''
    if result.get('requires_captcha'):
        success, captcha_b64 = get_captcha_image(session_id)
        # 这里简化处理，实际需要用户输入验证码
    
    # 尝试登录
    success, result, user_info = password_login(session_id, password, captcha)

    if success:
        # 保存 portal 会话以便后续使用（成绩单同步、课表同步等）
        session = get_login_session(session_id)
        if session:
            user = create_or_update_student(
                username=user_info['username'],
                name=user_info.get('name')
            )
            _portal_sessions[user.id] = {
                'client': session['client'],
                'timestamp': datetime.now()
            }
        # 清理临时会话
        if session_id in _login_sessions:
            del _login_sessions[session_id]
        return True, user_info, "session_based_auth"
    else:
        # 清理临时会话
        if session_id in _login_sessions:
            del _login_sessions[session_id]
        return False, result, None
