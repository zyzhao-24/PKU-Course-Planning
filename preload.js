const { contextBridge, ipcRenderer } = require('electron');

// 安全地暴露最小化 IPC API
contextBridge.exposeInMainWorld('electronAPI', {
  // 监听来自主进程的导航事件
  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (event, path) => {
      callback(path);
    });
  },
  // 移除导航监听
  removeNavigateListener: () => {
    ipcRenderer.removeAllListeners('navigate');
  },
  getAppSettings: () => ipcRenderer.invoke('app-settings:get'),
  setCloseActionPreference: (closeAction) => ipcRenderer.invoke('app-settings:set-close-action', closeAction),
  setCoursePlanningDisclaimerVisible: (visible) => ipcRenderer.invoke('app-settings:set-course-planning-disclaimer-visible', visible)
});
