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
  const [step, setStep] = useState('username');
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
  const activeQrSessionRef = useRef(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    beginPassword();

    return () => {
      stopPolling();
      requestSeqRef.current += 1;
    };
  }, [isOpen]);

  function stopPolling() {
    activeQrSessionRef.current = null;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function resetFields({ keepUsername = false } = {}) {
    setSessionId(null);
    setPublicKey(null);
    if (!keepUsername) setUsername('');
    setPassword('');
    setCaptcha('');
    setSmsCode('');
    setOtpCode('');
    setRequirements({});
    setCaptchaImage(null);
    setQrImage(null);
    setError('');
  }

  async function beginPassword({ keepUsername = false } = {}) {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    stopPolling();
    setMethod('password');
    setStep('username');
    resetFields({ keepUsername });
    setLoading(true);

    try {
      const res = await axios.post('/api/portal/init', { method: 'password' });
      if (requestSeqRef.current !== seq) return;

      if (res.data.success) {
        setSessionId(res.data.session_id);
        setPublicKey(res.data.public_key || null);
        return;
      }
      throw new Error(res.data.message || '无法初始化北大登录');
    } catch (err) {
      if (requestSeqRef.current === seq) {
        setError(err.response?.data?.message || err.message);
      }
    } finally {
      if (requestSeqRef.current === seq) {
        setLoading(false);
      }
    }
  }

  async function beginQr() {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    stopPolling();
    setMethod('qr');
    setStep('qr');
    resetFields();
    setLoading(true);

    try {
      const initRes = await axios.post('/api/portal/init', { method: 'qr' });
      if (requestSeqRef.current !== seq) return;

      if (!initRes.data.success) {
        throw new Error(initRes.data.message || '无法初始化北大登录');
      }

      const sid = initRes.data.session_id;
      setSessionId(sid);
      activeQrSessionRef.current = sid;

      const qrRes = await axios.get(`/api/portal/qr?session_id=${sid}`);
      if (requestSeqRef.current !== seq) return;

      if (qrRes.data.success) {
        setQrImage(qrRes.data.qr_image);
        pollQr(sid);
        return;
      }
      throw new Error(qrRes.data.message || '无法获取二维码');
    } catch (err) {
      if (requestSeqRef.current === seq) {
        setError(err.response?.data?.message || err.message);
      }
    } finally {
      if (requestSeqRef.current === seq) {
        setLoading(false);
      }
    }
  }

  const checkAuth = async (event) => {
    event.preventDefault();
    if (!username.trim() || !sessionId) return;
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
    stopPolling();
    requestSeqRef.current += 1;
    onCancel?.();
  };

  const finish = () => {
    stopPolling();
    requestSeqRef.current += 1;
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
    if (activeQrSessionRef.current !== sid) return;

    try {
      const res = await axios.post('/api/portal/qr-poll', { session_id: sid });
      if (activeQrSessionRef.current !== sid) return;

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
      if (activeQrSessionRef.current === sid) {
        setError(err.response?.data?.message || err.message);
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="连接北大账号"
      onCancel={close}
      hideFooter
    >
      <div style={{
        display: 'flex',
        gap: '8px',
        padding: '4px',
        marginBottom: '16px',
        backgroundColor: '#f1f5f9',
        borderRadius: '8px'
      }}>
        <button
          type="button"
          className={method === 'password' ? 'btn btn-primary' : 'btn btn-secondary'}
          style={{ flex: 1 }}
          disabled={loading && method === 'password'}
          onClick={() => beginPassword({ keepUsername: true })}
        >
          密码登录
        </button>
        <button
          type="button"
          className={method === 'qr' ? 'btn btn-primary' : 'btn btn-secondary'}
          style={{ flex: 1 }}
          disabled={loading && method === 'qr'}
          onClick={beginQr}
        >
          二维码登录
        </button>
      </div>

      {error && <div className="status-bar status-error" style={{ marginBottom: '15px' }}>{error}</div>}

      {method === 'password' && step === 'username' && (
        <form onSubmit={checkAuth}>
          <div className="form-group">
            <label>账号</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <button className="btn btn-primary" disabled={loading || !username.trim() || !sessionId} style={{ width: '100%' }}>
            {loading ? '初始化中...' : '下一步'}
          </button>
        </form>
      )}

      {method === 'password' && step === 'password' && (
        <form onSubmit={submitPassword}>
          <div className="form-group">
            <label>账号</label>
            <input
              value={username}
              readOnly
              style={{ backgroundColor: '#f8fafc', color: '#64748b' }}
            />
          </div>

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
                    style={{ height: '40px', cursor: 'pointer', borderRadius: '4px' }}
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

          <button
            type="button"
            className="btn btn-text"
            style={{ width: '100%', marginTop: '10px' }}
            onClick={() => setStep('username')}
          >
            返回修改账号
          </button>
        </form>
      )}

      {method === 'qr' && (
        <div style={{ textAlign: 'center' }}>
          {qrImage ? (
            <img
              src={`data:image/jpeg;base64,${qrImage}`}
              alt="北大登录二维码"
              style={{ width: '220px', height: '220px' }}
            />
          ) : (
            <div style={{ padding: '40px 0' }}>{loading ? '二维码加载中...' : '等待二维码...'}</div>
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
