/**
 * RSA加密工具 - 用于安全传输登录凭据
 */

/**
 * 将PEM格式的公钥转换为SubtleCrypto可用的格式
 * @param {string} pem - PEM格式的公钥
 * @returns {CryptoKey} - Web Crypto API的CryptoKey对象
 */
async function importPublicKey(pem) {
  // 移除PEM头尾和换行
  const pemHeader = '-----BEGIN PUBLIC KEY-----';
  const pemFooter = '-----END PUBLIC KEY-----';
  let pemContents = pem.replace(pemHeader, '').replace(pemFooter, '').replace(/\s/g, '');
  
  // Base64解码
  const binaryDer = window.atob(pemContents);
  
  // 转换为ArrayBuffer
  const binaryDerBuffer = new ArrayBuffer(binaryDer.length);
  const view = new Uint8Array(binaryDerBuffer);
  for (let i = 0; i < binaryDer.length; i++) {
    view[i] = binaryDer.charCodeAt(i);
  }
  
  // 导入公钥
  return await window.crypto.subtle.importKey(
    'spki',
    binaryDerBuffer,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256'
    },
    false,
    ['encrypt']
  );
}

/**
 * 使用RSA公钥加密数据
 * @param {string} publicKeyPem - PEM格式的公钥
 * @param {object} data - 要加密的数据对象
 * @returns {Promise<string>} - Base64编码的加密数据
 */
export async function encryptWithRSA(publicKeyPem, data) {
  try {
    // 导入公钥
    const publicKey = await importPublicKey(publicKeyPem);
    
    // 将数据转换为JSON字符串
    const jsonString = JSON.stringify(data);
    
    // 转换为ArrayBuffer
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(jsonString);
    
    // 加密
    const encryptedBuffer = await window.crypto.subtle.encrypt(
      {
        name: 'RSA-OAEP'
      },
      publicKey,
      dataBuffer
    );
    
    // 转换为Base64
    const encryptedArray = new Uint8Array(encryptedBuffer);
    let binaryString = '';
    for (let i = 0; i < encryptedArray.byteLength; i++) {
      binaryString += String.fromCharCode(encryptedArray[i]);
    }
    return window.btoa(binaryString);
  } catch (error) {
    console.error('RSA加密失败:', error);
    throw new Error('加密失败: ' + error.message);
  }
}

/**
 * 安全登录流程
 * 1. 获取公钥
 * 2. 加密凭据
 * 3. 发送登录请求
 * 
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @param {string} type - 登录类型 ('student' | 'admin')
 * @param {Function} apiRequest - API请求函数 (axios.post)
 * @returns {Promise<object>} - 登录结果
 */
export async function secureLogin(username, password, type, apiRequest) {
  // 步骤1: 获取公钥
  const publicKeyResponse = await apiRequest('/api/auth/public-key', {
    username
  });
  
  if (!publicKeyResponse.data.success) {
    throw new Error(publicKeyResponse.data.message || '获取公钥失败');
  }
  
  const { key_id, public_key: publicKey } = publicKeyResponse.data;
  
  // 步骤2: 加密凭据
  const credentials = {
    username,
    password
  };
  
  const encryptedCredentials = await encryptWithRSA(publicKey, credentials);
  
  // 步骤3: 发送登录请求
  const loginResponse = await apiRequest('/api/auth/login', {
    username,
    encrypted_credentials: encryptedCredentials,
    key_id,
    type
  });
  
  return loginResponse.data;
}