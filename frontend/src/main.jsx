import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// 监听 Electron 导航事件（通过 preload.js 安全暴露的 API）
if (window.electronAPI?.onNavigate) {
  window.electronAPI.onNavigate((path) => {
    window.location.hash = path;
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
