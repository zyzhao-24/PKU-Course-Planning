import React, { useEffect, useRef, useState } from 'react';
import axios from '../utils/axios';
import Modal from './Modal';
import { isCryptoAvailable } from '../contexts/AuthContext';

async function encryptWithSessionKey(publicKeyPem, text) {
  if (!isCryptoAvailable()) {
    throw new Error('当前环境不支持安全加密，请使用 localhost 或 HTTPS 访问。');
  }

  const pemHeader = '-----BEGIN PUBLIC KEY-----';
  const pemFooter = '-----END PUBLIC KEY-----';
  const pemContents = publicKeyPem
    .replace(pemHeader, '')
    .replace(pemFooter, '')
    .replace(/\s/g, '');

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

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    new TextEncoder().encode(text)
  );

  const encryptedArray = new Uint8Array(encryptedBuffer);
  let binaryString = '';
  for (let i = 0; i < encryptedArray.byteLength; i++) {
    binaryString += String.fromCharCode(encryptedArray[i]);
  }
  return window.btoa(binaryString);
}

function PortalConnectModal({ isOpen, onCancel, onConnected }) {
  const [method, setMethod] = useState('password');
  const [sessionId, setSessionId] = useState(null);
  const [publicKey, setPublicKey] = useState(null);
  const [step, setStep] = useState('method');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [requirements, setRequirements] = useState({});
  const [captchaImage, setCaptchaImage] = useState(null);
  const [qrImage, setQrImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pollTimerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setMethod('password');
    setSessionId(null);
    setPublicKey(null);
    setStep('method');
    setUsername('');
    setPassword('');
    setCaptcha('');
    setSmsCode('');
    setOtpCode('');
    setRequirements({});
    setCaptchaImage(null);
    setQrImage(null);
    setError('');
  }, [isOpen]);

  useEffect(() => () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
  }, []);

  const initSession = async (nextMethod) => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('/api/portal/init', { method: nextMethod });
      if (res.data.success) {
        setSessionId(res.data.session_id);
        setPublicKey(res.data.public_key || null);
        return res.data.session_id;
      }
      throw new Error(res.data.message || '无法初始化北大登录');
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const choosePassword = async () => {
    setMethod('password');
    const sid = await initSession('password');
    if (sid) setStep('username');
  };

  const chooseQr = async () => {
    setMethod('qr');
    const sid = await initSession('qr');
    if (!sid) return;
    setLoading(true);
    try {
      const res = await axios.get(`/api/portal/qr?session_id=${sid}`);
      if (res.data.success) {
        setQrImage(res.data.qr_image);
        setStep('qr');
        pollQr(sid);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const checkAuth = async (event) => {
    event.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('/api/portal/check-auth', {
        session_id: sessionId,
        username
      });
      setRequirements(res.data);
      if (res.data.requires_captcha) {
        await fetchCaptcha();
      }
      setStep('password');
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCaptcha = async () => {
    const res = await axios.get(`/api/portal/captcha?session_id=${sessionId}`);
    if (res.data.success) {
      setCaptchaImage(res.data.captcha_image);
    }
  };

  const sendSms = async () => {
    setLoading(true);
    setError('');
    try {
      await axios.post('/api/portal/sms', { session_id: sessionId });
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    onCancel?.();
  };

  const finish = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    onConnected?.();
  };

  const submitPassword = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const encryptedPassword = await encryptWithSessionKey(publicKey, password);
      const res = await axios.post('/api/portal/login-password', {
        session_id: sessionId,
        encrypted_password: encryptedPassword,
        captcha,
        sms_code: smsCode,
        otp_code: otpCode
      });
      if (res.data.success && res.data.portal_connected) {
        finish();
      }
    } catch (err) {
      const data = err.response?.data;
      setError(data?.message || err.message);
      if (data?.captcha_image) {
        setCaptchaImage(data.captcha_image);
        setCaptcha('');
      }
    } finally {
      setLoading(false);
    }
  };

  const pollQr = async (sid) => {
    try {
      const res = await axios.post('/api/portal/qr-poll', { session_id: sid });
      if (res.data.success && res.data.portal_connected) {
        finish();
        return;
      }
      if (res.data.is_stop) {
        setError(res.data.message || '二维码登录失败');
        return;
      }
      pollTimerRef.current = setTimeout(() => pollQr(sid), 2000);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="连接北大账号"
      onCancel={close}
      hideFooter
    >
      {error && <div className="status-bar status-error" style={{ marginBottom: '15px' }}>{error}</div>}

      {step === 'method' && (
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={loading} onClick={choosePassword}>
            密码登录
          </button>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={loading} onClick={chooseQr}>
            二维码登录
          </button>
        </div>
      )}

      {step === 'username' && (
        <form onSubmit={checkAuth}>
          <div className="form-group">
            <label>账号</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <button className="btn btn-primary" disabled={loading || !username.trim()} style={{ width: '100%' }}>
            下一步
          </button>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={submitPassword}>
          <div className="form-group">
            <label>密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>

          {requirements.requires_captcha && (
            <div className="form-group">
              <label>验证码</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input value={captcha} onChange={(e) => setCaptcha(e.target.value)} />
                {captchaImage && (
                  <img
                    src={`data:image/jpeg;base64,${captchaImage}`}
                    alt="验证码"
                    onClick={fetchCaptcha}
                    style={{ height: '40px', cursor: 'pointer' }}
                  />
                )}
              </div>
            </div>
          )}

          {requirements.requires_sms && (
            <div className="form-group">
              <label>短信验证码 {requirements.mobile_mask && `(${requirements.mobile_mask})`}</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input value={smsCode} onChange={(e) => setSmsCode(e.target.value)} />
                <button type="button" className="btn btn-secondary" onClick={sendSms} disabled={loading}>
                  发送
                </button>
              </div>
            </div>
          )}

          {requirements.requires_otp && (
            <div className="form-group">
              <label>OTP</label>
              <input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} />
            </div>
          )}

          <button className="btn btn-primary" disabled={loading || !password} style={{ width: '100%' }}>
            {loading ? '连接中...' : '连接并继续同步'}
          </button>
        </form>
      )}

      {step === 'qr' && (
        <div style={{ textAlign: 'center' }}>
          {qrImage ? (
            <img
              src={`data:image/jpeg;base64,${qrImage}`}
              alt="北大登录二维码"
              style={{ width: '220px', height: '220px' }}
            />
          ) : (
            <div>二维码加载中...</div>
          )}
          <div style={{ marginTop: '15px', color: '#666' }}>请使用北京大学 App 扫码</div>
        </div>
      )}

      <button
        type="button"
        className="btn btn-text"
        style={{ width: '100%', marginTop: '15px' }}
        onClick={close}
      >
        取消
      </button>
    </Modal>
  );
}

export default PortalConnectModal;
