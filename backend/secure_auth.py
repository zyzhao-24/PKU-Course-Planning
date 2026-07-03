"""
安全认证模块 - 使用RSA-OAEP加密传输凭据
"""
import base64
import uuid
import hashlib
from datetime import datetime, timedelta
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP
from Crypto.Hash import SHA256
from flask import jsonify

# 内存缓存：存储临时RSA密钥对
# 格式: {username: {'key_id': str, 'private_key': RSA, 'public_key_pem': str, 'created_at': datetime}}
_rsa_key_cache = {}

# 密钥有效期（分钟）
KEY_VALIDITY_MINUTES = 5

def generate_rsa_keypair(username):
    """
    生成RSA密钥对并存储到内存缓存
    返回: (key_id, public_key_pem)
    """
    # 清除该用户之前的密钥
    if username in _rsa_key_cache:
        del _rsa_key_cache[username]
    
    # 生成新的2048位RSA密钥对
    key = RSA.generate(2048)
    private_key = key
    public_key = key.publickey()
    
    # 导出公钥为PEM格式 (SubjectPublicKeyInfo格式，与Web Crypto API兼容)
    public_key_pem = public_key.export_key(format='PEM', pkcs=8).decode('utf-8')
    
    # 生成唯一key_id
    key_id = str(uuid.uuid4())
    
    # 存储到缓存
    _rsa_key_cache[username] = {
        'key_id': key_id,
        'private_key': private_key,
        'public_key_pem': public_key_pem,
        'created_at': datetime.now()
    }
    
    return key_id, public_key_pem

def get_rsa_public_key(username):
    """
    获取或生成RSA公钥
    返回: {'key_id': str, 'public_key': str} 或 None
    """
    # 检查现有密钥是否过期
    if username in _rsa_key_cache:
        key_data = _rsa_key_cache[username]
        age = datetime.now() - key_data['created_at']
        if age > timedelta(minutes=KEY_VALIDITY_MINUTES):
            # 密钥过期，删除
            del _rsa_key_cache[username]
        else:
            # 返回现有公钥
            return {
                'key_id': key_data['key_id'],
                'public_key': key_data['public_key_pem']
            }
    
    # 生成新密钥
    key_id, public_key_pem = generate_rsa_keypair(username)
    return {
        'key_id': key_id,
        'public_key': public_key_pem
    }

def decrypt_credentials(username, encrypted_data, key_id=None):
    """
    使用私钥解密加密的凭据 (RSA-OAEP with SHA-256)

    参数:
        username: 用户名
        encrypted_data: base64编码的加密数据
        key_id: 客户端传回的密钥ID（可选，如提供则验证）

    返回:
        (success: bool, result: dict or error_msg)
        result格式: {'username': str, 'password': str}
    """
    # 检查密钥是否存在
    if username not in _rsa_key_cache:
        return False, 'RSA密钥不存在或已过期，请重新获取公钥'

    key_data = _rsa_key_cache[username]

    # 验证 key_id（防止密钥混淆攻击）
    if key_id and key_data.get('key_id') != key_id:
        return False, '密钥ID不匹配，请重新获取公钥'

    # 检查密钥是否过期
    age = datetime.now() - key_data['created_at']
    if age > timedelta(minutes=KEY_VALIDITY_MINUTES):
        del _rsa_key_cache[username]
        return False, 'RSA密钥已过期，请重新获取公钥'

    try:
        # 解码base64
        encrypted_bytes = base64.b64decode(encrypted_data)
        
        # 使用私钥解密 (RSA-OAEP with SHA-256，与Web Crypto API兼容)
        cipher = PKCS1_OAEP.new(key_data['private_key'], hashAlgo=SHA256)
        decrypted_bytes = cipher.decrypt(encrypted_bytes)
        
        if decrypted_bytes is None or len(decrypted_bytes) == 0:
            return False, '解密失败，数据可能已损坏'
        
        # 解析JSON格式的凭据
        import json
        credentials = json.loads(decrypted_bytes.decode('utf-8'))
        
        # 验证必需字段
        if 'username' not in credentials or 'password' not in credentials:
            return False, '凭据格式错误'
        
        # 验证用户名匹配
        if credentials['username'] != username:
            return False, '用户名不匹配'
        
        return True, credentials
        
    except Exception as e:
        return False, f'解密失败: {str(e)}'

def remove_rsa_key(username):
    """
    登录成功后移除RSA密钥（防止重放攻击）
    """
    if username in _rsa_key_cache:
        del _rsa_key_cache[username]

def cleanup_expired_keys():
    """
    清理过期的密钥（可选，用于定期维护）
    """
    now = datetime.now()
    expired_users = []
    for username, key_data in _rsa_key_cache.items():
        age = now - key_data['created_at']
        if age > timedelta(minutes=KEY_VALIDITY_MINUTES):
            expired_users.append(username)
    
    for username in expired_users:
        del _rsa_key_cache[username]
    
    return len(expired_users)
