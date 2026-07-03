import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, isCryptoAvailable } from '../contexts/AuthContext';
import { useSemester } from '../contexts/SemesterContext';
import axios from '../utils/axios';

// RSA加密函数
async function encryptWithSessionKey(publicKeyPem, text) {
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

function Login() {
  const navigate = useNavigate();
  const { login: adminLogin, checkAuthStatus } = useAuth();
  const { refreshSemesters } = useSemester();
  
  // 标签状态
  const [activeTab, setActiveTab] = useState('student'); // 'student' | 'admin'
  
  // 学生登录方式
  const [studentLoginMethod, setStudentLoginMethod] = useState('password'); // 'password' | 'qr'
  
  // 登录会话状态
  const [sessionId, setSessionId] = useState(null);
  const [publicKey, setPublicKey] = useState(null);
  
  // 表单状态
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [otpCode, setOtpCode] = useState('');
  
  // 认证需求
  const [authRequirements, setAuthRequirements] = useState({
    requires_captcha: false,
    requires_sms: false,
    requires_otp: false,
    requires_bind_otp: false,
    mobile_mask: ''
  });
  
  // UI状态
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('method'); // 'method' | 'username' | 'auth' | 'password' | 'qr'
  
  // 验证码和二维码图片
  const [captchaImage, setCaptchaImage] = useState(null);
  const [qrImage, setQrImage] = useState(null);
  
  // 密码显示/隐藏
  const [showPassword, setShowPassword] = useState(false);
  
  // 短信验证码倒计时
  const [smsCountdown, setSmsCountdown] = useState(0);
  
  // 轮询定时器
  const pollTimerRef = useRef(null);
  // 轮询计数
  const pollCountRef = useRef(0);
  // 短信倒计时定时器
  const smsTimerRef = useRef(null);
  // QR登录加载状态（使用ref避免异步state竞态条件）
  const qrLoadingRef = useRef(false);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  // 切换标签时重置状态
  useEffect(() => {
    setError('');
    setStep('method');
    setSessionId(null);
    setPublicKey(null);
    setUsername('');
    setPassword('');
    setCaptcha('');
    setSmsCode('');
    setOtpCode('');
    setCaptchaImage(null);
    setQrImage(null);
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }
  }, [activeTab, studentLoginMethod]);

  // ==================== 学生登录流程 ====================

  // 初始化登录会话
  const initSession = async (method) => {
    try {
      setLoading(true);
      const response = await axios.post('/api/auth/student/init', { method });
      
      if (response.data.success) {
        const newSessionId = response.data.session_id;
        setSessionId(newSessionId);
        if (response.data.public_key) {
          setPublicKey(response.data.public_key);
        }
        return { success: true, sessionId: newSessionId };
      }
    } catch (err) {
      setError(err.response?.data?.message || '初始化登录失败');
    } finally {
      setLoading(false);
    }
    return { success: false };
  };

  // 检查认证需求
  const checkAuth = async () => {
    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }
    
    setError(''); // 清除之前的错误
    
    try {
      setLoading(true);
      const response = await axios.post('/api/auth/student/check-auth', {
        session_id: sessionId,
        username
      });
      
      if (response.data.success) {
        setAuthRequirements({
          requires_captcha: response.data.requires_captcha,
          requires_sms: response.data.requires_sms,
          requires_otp: response.data.requires_otp,
          requires_bind_otp: response.data.requires_bind_otp,
          mobile_mask: response.data.mobile_mask
        });
        
        // 如果需要验证码，获取验证码图片
        if (response.data.requires_captcha) {
          await fetchCaptcha();
        }
        
        setStep('auth');
      }
    } catch (err) {
      setError(err.response?.data?.message || '检查认证需求失败');
    } finally {
      setLoading(false);
    }
  };

  // 获取验证码
  const fetchCaptcha = async () => {
    try {
      const response = await axios.get(`/api/auth/student/captcha?session_id=${sessionId}`);
      if (response.data.success) {
        setCaptchaImage(response.data.captcha_image);
      }
    } catch (err) {
      console.error('获取验证码失败:', err);
    }
  };

  // 发送短信验证码
  const sendSms = async () => {
    try {
      setLoading(true);
      const response = await axios.post('/api/auth/student/sms', {
        session_id: sessionId
      });
      
      if (response.data.success) {
        setError('');
        // 开始倒计时
        setSmsCountdown(60);
        if (smsTimerRef.current) {
          clearInterval(smsTimerRef.current);
        }
        smsTimerRef.current = setInterval(() => {
          setSmsCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(smsTimerRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    } catch (err) {
      setError(err.response?.data?.message || '发送短信失败');
    } finally {
      setLoading(false);
    }
  };

  // 清理短信倒计时
  useEffect(() => {
    return () => {
      if (smsTimerRef.current) {
        clearInterval(smsTimerRef.current);
      }
    };
  }, []);

  // 执行密码登录
  const doPasswordLogin = async () => {
    if (!password) {
      setError('请输入密码');
      return;
    }
    
    setError(''); // 清除之前的错误
    
    try {
      setLoading(true);
      
      // 加密密码
      const encryptedPassword = await encryptWithSessionKey(publicKey, password);
      
      const response = await axios.post('/api/auth/student/login-password', {
        session_id: sessionId,
        encrypted_password: encryptedPassword,
        captcha: captcha,
        sms_code: smsCode,
        otp_code: otpCode
      });
      
      if (response.data.success) {
        // 登录成功
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        // 更新 AuthContext 状态并导航
        await checkAuthStatus();
        await refreshSemesters();  // 确保学期数据在导航前加载
        navigate('/student/courses');
        return; // 确保成功后直接返回，不执行后续代码
      } else {
        // 登录失败
        setError(response.data.message || '登录失败');
      }
    } catch (err) {
      const data = err.response?.data;
      setError(data?.message || '登录失败');
      
      // 如果需要新验证码
      if (data?.requires_captcha && data?.captcha_image) {
        setCaptchaImage(data.captcha_image);
        setAuthRequirements(prev => ({ ...prev, requires_captcha: true }));
        setCaptcha('');
      }
    } finally {
      setLoading(false);
    }
  };

  // 开始二维码登录
  const startQrLogin = async () => {
    // 使用ref防止重复调用（避免异步state竞态条件）
    if (qrLoadingRef.current) return;

    pollCountRef.current = 0;
    qrLoadingRef.current = true;
    setLoading(true);

    try {
      // 确保先清除旧会话
      setSessionId(null);
      setQrImage(null);

      const result = await initSession('qr');
      console.log('QR init result:', result); // 调试日志

      if (result.success && result.sessionId) {
        // 直接使用返回的 sessionId
        const newSessionId = result.sessionId;
        setSessionId(newSessionId);

        // 立即获取二维码
        console.log('Fetching QR with session:', newSessionId); // 调试日志
        const response = await axios.get(`/api/auth/student/qr?session_id=${newSessionId}`);

        if (response.data.success) {
          setQrImage(response.data.qr_image);
          setStep('qr');
          // 开始轮询
          pollQrStatusWithSessionId(newSessionId);
        } else {
          setError('获取二维码失败: ' + response.data.message);
        }
      } else {
        setError('初始化登录会话失败: ' + (result.error || '未知错误'));
      }
    } catch (err) {
      console.error('QR login error:', err); // 调试日志
      setError('获取二维码失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
      qrLoadingRef.current = false;
    }
  };

  // 轮询二维码状态（带 sessionId 参数版本）
  const pollQrStatusWithSessionId = async (sid) => {
    pollCountRef.current += 1;
    
    // 60次轮询后刷新二维码（约2分钟）
    if (pollCountRef.current >= 60) {
      setError('二维码已过期，正在刷新...');
      pollCountRef.current = 0;
      try {
        const response = await axios.get(`/api/auth/student/qr?session_id=${sid}`);
        if (response.data.success) {
          setQrImage(response.data.qr_image);
        }
      } catch (err) {
        console.error('刷新二维码失败:', err);
      }
      setError('');
      pollTimerRef.current = setTimeout(() => pollQrStatusWithSessionId(sid), 2000);
      return;
    }
    
    try {
      const response = await axios.post('/api/auth/student/qr-poll', {
        session_id: sid
      });
      
      const data = response.data;
      
      // 登录成功（后端返回token）
      if (data.success && data.token) {
        // 登录成功
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        // 更新 AuthContext 状态并导航
        await checkAuthStatus();
        await refreshSemesters();  // 确保学期数据在导航前加载
        navigate('/student/courses');
        return;
      }
      
      // 处理需要停止的错误
      if (data.is_stop || data.status === 'stopped') {
        setError(data.message || '登录失败，请重试');
        return;
      }
      
      // 继续轮询（waiting状态或无token时）
      if (data.status === 'waiting' || data.status === 'error' || !data.token) {
        pollTimerRef.current = setTimeout(() => pollQrStatusWithSessionId(sid), 2000);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || '二维码登录失败';
      setError(errorMsg);
      // 如果不是致命错误，继续轮询
      if (!errorMsg.includes('过期')) {
        pollTimerRef.current = setTimeout(() => pollQrStatusWithSessionId(sid), 2000);
      }
    }
  };

  // 获取二维码
  const fetchQrCode = async () => {
    try {
      const response = await axios.get(`/api/auth/student/qr?session_id=${sessionId}`);
      if (response.data.success) {
        setQrImage(response.data.qr_image);
      }
    } catch (err) {
      setError('获取二维码失败');
    }
  };

  // 轮询二维码状态
  const pollQrStatus = async () => {
    pollCountRef.current += 1;
    
    // 60次轮询后刷新二维码（约2分钟）
    if (pollCountRef.current >= 60) {
      setError('二维码已过期，正在刷新...');
      pollCountRef.current = 0;
      await fetchQrCode();
      setError('');
      pollTimerRef.current = setTimeout(pollQrStatus, 2000);
      return;
    }
    
    try {
      const response = await axios.post('/api/auth/student/qr-poll', {
        session_id: sessionId
      });
      
      const data = response.data;
      
      // 登录成功（后端返回token）
      if (data.success && data.token) {
        // 登录成功
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        // 更新 AuthContext 状态并导航
        await checkAuthStatus();
        await refreshSemesters();  // 确保学期数据在导航前加载
        navigate('/student/courses');
        return;
      }
      
      // 处理需要停止的错误
      if (data.is_stop || data.status === 'stopped') {
        setError(data.message || '登录失败，请重试');
        return;
      }
      
      // 继续轮询（waiting状态或无token时）
      if (data.status === 'waiting' || data.status === 'error' || !data.token) {
        pollTimerRef.current = setTimeout(pollQrStatus, 2000);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || '二维码登录失败';
      setError(errorMsg);
      // 如果不是致命错误，继续轮询
      if (!errorMsg.includes('过期')) {
        pollTimerRef.current = setTimeout(pollQrStatus, 2000);
      }
    }
  };

  // 切换登录方式
  const switchMethod = async (newMethod) => {
    // 清除所有状态
    setError('');
    setSessionId(null);
    setPublicKey(null);
    setUsername('');
    setPassword('');
    setCaptcha('');
    setSmsCode('');
    setOtpCode('');
    setCaptchaImage(null);
    setQrImage(null);
    setAuthRequirements({
      requires_captcha: false,
      requires_sms: false,
      requires_otp: false,
      requires_bind_otp: false,
      mobile_mask: ''
    });
    
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }
    
    setStudentLoginMethod(newMethod);
    
    if (newMethod === 'password') {
      const result = await initSession('password');
      if (result.success) {
        setStep('username');
      }
    } else {
      await startQrLogin();
    }
  };

  // ==================== 管理员登录 ====================

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await adminLogin(username, password, 'admin');
    
    if (result.success) {
      // 更新 AuthContext 状态并导航
      await checkAuthStatus();
      await refreshSemesters();  // 确保学期数据在导航前加载
      navigate('/admin/dashboard');
    } else {
      setError(result.message);
    }
    
    setLoading(false);
  };

  // ==================== 渲染 ====================

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#f0f4f8',
      padding: '20px'
    }}>
      <div className="card" style={{
        width: '100%',
        maxWidth: '400px',
        padding: '40px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(20px)',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.5)'
      }}>
        <h1 style={{
          textAlign: 'center',
          marginBottom: '30px',
          color: '#1a1a1a',
          fontSize: '24px',
          fontWeight: '600'
        }}>
          选课与毕业审查系统
        </h1>

        {/* 标签切换 */}
        <div style={{
          display: 'flex',
          marginBottom: '30px',
          borderBottom: '1px solid #e0e0e0'
        }}>
          <button
            type="button"
            onClick={() => setActiveTab('student')}
            style={{
              flex: 1,
              padding: '12px',
              border: 'none',
              backgroundColor: 'transparent',
              borderBottom: activeTab === 'student' ? '2px solid #0067c0' : 'none',
              color: activeTab === 'student' ? '#0067c0' : '#666',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: activeTab === 'student' ? '600' : 'normal',
              transition: 'all 0.2s'
            }}
          >
            学生登录
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('admin')}
            style={{
              flex: 1,
              padding: '12px',
              border: 'none',
              backgroundColor: 'transparent',
              borderBottom: activeTab === 'admin' ? '2px solid #0067c0' : 'none',
              color: activeTab === 'admin' ? '#0067c0' : '#666',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: activeTab === 'admin' ? '600' : 'normal',
              transition: 'all 0.2s'
            }}
          >
            管理员登录
          </button>
        </div>

        {error && (
          <div className="status-bar status-error" style={{ marginBottom: '20px' }}>
            {error}
          </div>
        )}

        {/* 学生登录 */}
        {activeTab === 'student' && (
          <>
            {/* 登录方式选择 */}
            {step === 'method' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ marginBottom: '20px', color: '#666' }}>
                  选择登录方式
                </p>
                <div style={{ display: 'flex', gap: '15px' }}>
                  <button
                    type="button"
                    onClick={() => switchMethod('password')}
                    disabled={loading}
                    className="btn btn-primary"
                    style={{ flex: 1, padding: '15px' }}
                  >
                    密码登录
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMethod('qr')}
                    disabled={loading}
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: '15px' }}
                  >
                    二维码登录
                  </button>
                </div>
              </div>
            )}

            {/* 用户名输入 */}
            {step === 'username' && (
              <form onSubmit={(e) => { e.preventDefault(); checkAuth(); }}>
                <div className="form-group">
                  <label>账号</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="学号/手机号"
                    required
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !username.trim()}
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px' }}
                >
                  {loading ? '检查中...' : '下一步'}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('method')}
                  className="btn btn-text"
                  style={{ width: '100%', marginTop: '10px' }}
                >
                  返回
                </button>
              </form>
            )}

            {/* 认证信息输入 */}
            {step === 'auth' && (
              <form onSubmit={(e) => { e.preventDefault(); doPasswordLogin(); }}>
                {/* 1. 账号（只读） */}
                <div className="form-group">
                  <label>学号</label>
                  <input
                    type="text"
                    value={username}
                    readOnly
                    style={{ 
                      backgroundColor: '#f5f5f5', 
                      color: '#666',
                      cursor: 'not-allowed'
                    }}
                  />
                </div>

                {/* 2. 密码（带显示/隐藏切换） */}
                <div className="form-group">
                  <label>密码</label>
                  <div style={{ display: 'flex', gap: '10px', position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="密码"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                      data-lpignore="true"
                      style={{ flex: 1, paddingRight: '40px' }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        fontSize: '14px',
                        color: '#666'
                      }}
                      tabIndex="-1"
                    >
                      {showPassword ? '😶' : '🫣'}
                    </button>
                  </div>
                </div>

                {/* 3. 验证码（如有） */}
                {authRequirements.requires_captcha && (
                  <div className="form-group">
                    <label>验证码</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <input
                        type="text"
                        value={captcha}
                        onChange={(e) => setCaptcha(e.target.value)}
                        placeholder="验证码"
                        style={{ flex: 1 }}
                      />
                      {captchaImage && (
                        <img
                          src={`data:image/jpeg;base64,${captchaImage}`}
                          alt="验证码"
                          onClick={fetchCaptcha}
                          style={{ 
                            height: '40px', 
                            cursor: 'pointer',
                            borderRadius: '4px'
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* 4. 短信验证码及发送按钮（如有） */}
                {authRequirements.requires_sms && (
                  <div className="form-group">
                    <label>短信验证码 {authRequirements.mobile_mask && `(${authRequirements.mobile_mask})`}</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <input
                        type="text"
                        value={smsCode}
                        onChange={(e) => setSmsCode(e.target.value)}
                        placeholder="短信验证码"
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={sendSms}
                        disabled={loading || smsCountdown > 0}
                        className="btn btn-secondary"
                        style={{ 
                          padding: '8px 16px', 
                          fontSize: '14px',
                          minWidth: '80px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {smsCountdown > 0 ? `${smsCountdown}s` : '发送'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 5. OTP（如有） */}
                {authRequirements.requires_otp && (
                  <div className="form-group">
                    <label>手机令牌</label>
                    <input
                      type="text"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="手机令牌"
                    />
                  </div>
                )}

                {authRequirements.requires_bind_otp && (
                  <div className="status-bar status-warning" style={{ marginBottom: '15px' }}>
                    需要绑定OTP令牌，请访问
                    <a href="https://iaaa.pku.edu.cn/iaaa/resources/help/otpHelp.html" target="_blank" rel="noopener noreferrer">
                      OTP帮助页面
                    </a>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !password}
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px' }}
                >
                  {loading ? '登录中...' : '登录'}
                </button>
                
                <button
                  type="button"
                  onClick={() => setStep('username')}
                  className="btn btn-text"
                  style={{ width: '100%', marginTop: '10px' }}
                >
                  返回
                </button>
              </form>
            )}

            {/* 二维码登录 */}
            {step === 'qr' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ marginBottom: '15px', color: '#666' }}>
                  请使用"北京大学"APP扫描二维码
                </p>
                {qrImage ? (
                  <div style={{
                    padding: '20px',
                    backgroundColor: '#fff',
                    borderRadius: '8px',
                    display: 'inline-block',
                    marginBottom: '15px'
                  }}>
                    <img
                      src={`data:image/jpeg;base64,${qrImage}`}
                      alt="登录二维码"
                      style={{ width: '200px', height: '200px' }}
                    />
                  </div>
                ) : (
                  <div style={{ padding: '40px' }}>加载中...</div>
                )}
                <p style={{ fontSize: '12px', color: '#999' }}>
                  二维码每分钟自动刷新
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
                    pollCountRef.current = 0;
                    setStep('method');
                  }}
                  className="btn btn-text"
                  style={{ marginTop: '15px' }}
                >
                  返回选择登录方式
                </button>
              </div>
            )}
          </>
        )}

        {/* 管理员登录 */}
        {activeTab === 'admin' && (
          <form onSubmit={handleAdminLogin}>
            <div className="form-group">
              <label>用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入管理员账号"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>密码</label>
              <div style={{ display: 'flex', gap: '10px', position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  required
                  style={{ flex: 1, paddingRight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    fontSize: '14px',
                    color: '#666'
                  }}
                  tabIndex="-1"
                >
                  {showPassword ? '😶' : '🫣'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', marginTop: '10px' }}
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>
        )}

        {activeTab === 'student' && step === 'method' && (
          <div style={{
            marginTop: '20px',
            textAlign: 'center',
            color: '#666',
            fontSize: '12px',
            lineHeight: '1.5'
          }}>
            学生使用北京大学统一身份认证账号登录
            <br />
            首次登录将自动创建账号
            <br />
            <span style={{ color: '#8b0012', fontWeight: 'bold' }}>警告：</span>
            本程序后端可能会储存你的选课和成绩信息，
            请确保你所使用的访问方式是客户端或者你自己搭建的服务器，以免信息泄露
            <br />
            <span style={{ color: '#8b0012', fontWeight: 'bold' }}>服务器仅供连接移动设备使用，不得用于向他人提供服务</span>
            <br />
            密码通过RSA加密传输，且不会被服务器存储
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;