import axios from 'axios';

// 配置 axios 默认值
// 开发环境：使用空字符串（通过 Vite dev server 代理）
// 生产环境：使用当前页面的 host 和协议
const isDev = import.meta.env.DEV;

// 生产环境使用当前页面的协议和 host
// 这样无论 HTTP 还是 HTTPS 都能正确连接
if (window.location.protocol === 'https:') {
  axios.defaults.baseURL = `https://${window.location.host}`;
} else {
  axios.defaults.baseURL = isDev ? '' : 'http://127.0.0.1:5000';
}

// 添加请求拦截器
axios.interceptors.request.use(
  (config) => {
    // 从 localStorage 获取 token
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 添加响应拦截器
axios.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // 处理 401 错误
    if (error.response && error.response.status === 401) {
      // 清除本地存储的认证信息
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      
      // 如果不是在登录页面，重定向到登录页
      // 注意：使用 HashRouter，需要检查 hash
      const isLoginPage = window.location.hash.includes('/login');
      if (!isLoginPage) {
        window.location.href = '/#/login';
      }
    }
    return Promise.reject(error);
  }
);

export default axios;