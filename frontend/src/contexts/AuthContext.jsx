import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from '../utils/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  // 检查登录状态（页面刷新时调用）
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await axios.get('/api/auth/check', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (res.data.success && res.data.authenticated) {
        setUser(res.data.user);
        setIsAuthenticated(true);
      } else {
        // 如果 portal 会话过期，清除本地存储
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    } catch (err) {
      // Token 无效或过期
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } finally {
      setLoading(false);
    }
  };

  // 管理员登录
  const login = async (username, password, type = 'student') => {
    try {
      // 1. 获取 RSA 公钥
      const keyRes = await axios.post('/api/auth/public-key', { username });
      if (!keyRes.data.success) {
        return { success: false, message: '无法获取加密密钥' };
      }

      const { key_id, public_key } = keyRes.data;

      // 2. 加密凭据
      const credentials = JSON.stringify({ username, password });
      const encrypted = await encryptWithPublicKey(public_key, credentials);

      // 3. 登录
      const loginRes = await axios.post('/api/auth/login', {
        username,
        encrypted_credentials: encrypted,
        key_id,
        type
      });

      if (loginRes.data.success) {
        const { token, user } = loginRes.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        setUser(user);
        setIsAuthenticated(true);
        return { success: true };
      }
    } catch (err) {
      const msg = err.response?.data?.message || '登录失败';
      return { success: false, message: msg };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      loading,
      login,
      logout,
      checkAuthStatus
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// 检查 crypto.subtle 是否可用
export function isCryptoAvailable() {
  return typeof window !== 'undefined' && 
         window.crypto && 
         window.crypto.subtle;
}
  
// RSA 加密函数（用于管理员登录）
async function encryptWithPublicKey(publicKeyPem, text) {
  // 检查 crypto API 可用性
  if (!isCryptoAvailable()) {
    console.error('Web Crypto API 不可用。可能原因：');
    console.error('1. 使用了 HTTP + IP 地址访问（非安全上下文）');
    console.error('2. 浏览器版本过旧');
    console.error('3. 在非 HTTPS 环境下使用');
    throw new Error('加密功能在当前环境中不可用。请使用 localhost 访问或配置 HTTPS。');
  }

  const pemHeader = '-----BEGIN PUBLIC KEY-----';
  const pemFooter = '-----END PUBLIC KEY-----';
  let pemContents = publicKeyPem.replace(pemHeader, '').replace(pemFooter, '').replace(/\s/g, '');
  
  const binaryDer = window.atob(pemContents);
  const binaryDerBuffer = new ArrayBuffer(binaryDer.length);
  const view = new Uint8Array(binaryDerBuffer);
  for (let i = 0; i < binaryDer.length; i++) {
    view[i] = binaryDer.charCodeAt(i);
  }
  
  const publicKey = await window.crypto.subtle.importKey(
    'spki',
    binaryDerBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
  
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(text);
  
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    dataBuffer
  );
  
  const encryptedArray = new Uint8Array(encryptedBuffer);
  let binaryString = '';
  for (let i = 0; i < encryptedArray.byteLength; i++) {
    binaryString += String.fromCharCode(encryptedArray[i]);
  }
  return window.btoa(binaryString);
}