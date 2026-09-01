const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const treeKill = require('tree-kill');

const logFile = path.join(app.getPath('userData'), 'app.log');
function log(message) {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} - ${message}\n`);
  } catch (e) {
    console.error('Failed to write log', e);
  }
}

let mainWindow;
let pythonProcess;
let tray;
let isQuitting = false;
let isHandlingClose = false;

// Changed to point to the folder structure created by --onedir
const PY_DIST_FOLDER = 'backend/dist/app';
const PY_SRC_FOLDER = 'backend';
const PY_MODULE = 'app.py';

const isDev = !app.isPackaged;
const BACKEND_PORT = isDev ? 5001 : 5000;
const BACKEND_BASE_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const settingsFile = isDev
  ? path.join(__dirname, 'app-settings.json')
  : path.join(app.getPath('userData'), 'app-settings.json');
const CLOSE_ACTIONS = new Set(['ask', 'quit', 'minimizeToTray']);
const DEFAULT_APP_SETTINGS = {
  schemaVersion: 1,
  window: {
    closeAction: 'ask',
  },
};

const normalizeAppSettings = (settings = {}) => {
  const closeAction = settings.window?.closeAction;
  return {
    schemaVersion: 1,
    window: {
      closeAction: CLOSE_ACTIONS.has(closeAction) ? closeAction : DEFAULT_APP_SETTINGS.window.closeAction,
    },
  };
};

const loadAppSettings = () => {
  try {
    if (!fs.existsSync(settingsFile)) {
      return normalizeAppSettings();
    }
    return normalizeAppSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8')));
  } catch (err) {
    log(`Failed to load app settings: ${err}`);
    return normalizeAppSettings();
  }
};

let appSettings = loadAppSettings();

const saveAppSettings = (nextSettings) => {
  appSettings = normalizeAppSettings(nextSettings);
  try {
    const tempFile = `${settingsFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(appSettings, null, 2), 'utf8');
    fs.renameSync(tempFile, settingsFile);
  } catch (err) {
    log(`Failed to save app settings: ${err}`);
  }
};

const setCloseActionPreference = (closeAction) => {
  saveAppSettings({
    ...appSettings,
    window: {
      ...appSettings.window,
      closeAction,
    },
  });
};

ipcMain.handle('app-settings:get', () => appSettings);

ipcMain.handle('app-settings:set-close-action', (_event, closeAction) => {
  setCloseActionPreference(closeAction);
  return appSettings;
});

const getAppIconPath = () => {
  const publicIconPath = path.join(__dirname, 'frontend/public/favicon.ico');
  if (fs.existsSync(publicIconPath)) {
    return publicIconPath;
  }
  return path.join(__dirname, 'frontend/dist/favicon.ico');
};

const loadUtf8Html = (browserWindow, html) => {
  const encodedHtml = Buffer.from(html, 'utf8').toString('base64');
  browserWindow.loadURL(`data:text/html;charset=UTF-8;base64,${encodedHtml}`);
};

const getTrayIcon = () => {
  if (process.platform === 'win32') {
    return getAppIconPath();
  }

  const fallbackPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAsklEQVR4AWP4z8Dwn4ECwESJ5GgGBrDB/3cPPxj+T0z6z8DAwPCfiYGB4Q+S8B8DAwPDf1Kzf2CphkA2LfzPwMDA8J+BgYHhP9WuXxvE6P8MDBySkv+fMTAwMPwH4mBg+E+i2P8ZGBgY/kNQ/f+UgYGB4T8DAwPDfzAWBn4GBgaG/0Q6TWMQhZsHYWBg+E/BoGkM4mgqg/z/H9SKxjAKaIYBAF9rJH8Npx39AAAAAElFTkSuQmCC';
  return nativeImage.createFromDataURL(fallbackPng);
};

const getPythonScriptPath = () => {
  if (!isDev) {
    return path.join(process.resourcesPath, PY_DIST_FOLDER, 'app.exe');
  }
  return path.join(__dirname, PY_SRC_FOLDER, PY_MODULE);
};

const startPythonSubprocess = () => {
  const scriptPath = getPythonScriptPath();
  log(`Starting python subprocess from: ${scriptPath}`);

  if (!isDev && !fs.existsSync(scriptPath)) {
    log(`CRITICAL ERROR: Python executable not found at ${scriptPath}`);
  }

  if (isDev) {
    pythonProcess = spawn('python', [scriptPath], {
      cwd: path.join(__dirname, 'backend'),
    });
  } else {
    pythonProcess = spawn(scriptPath, [], {
      cwd: path.dirname(scriptPath),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  if (pythonProcess != null) {
    const spawnedProcess = pythonProcess;
    log('child process spawned');
    pythonProcess.stdout.on('data', (data) => {
      log(`stdout: ${data}`);
    });
    pythonProcess.stderr.on('data', (data) => {
      log(`stderr: ${data}`);
    });
    pythonProcess.on('error', (err) => {
      log(`Failed to start python process: ${err}`);
    });
    pythonProcess.on('exit', (code, signal) => {
      log(`Python process exited with code ${code} and signal ${signal}`);
      if (pythonProcess === spawnedProcess) {
        pythonProcess = null;
      }
    });
  }
};

const exitPythonSubprocess = (callback) => {
  if (!pythonProcess) {
    if (callback) callback();
    return;
  }
  const pid = pythonProcess.pid;
  let isKilling = false;
  log(`Shutting down python process ${pid}`);
  // 请求Flask提交数据库后关闭
  const req = http.request(`${BACKEND_BASE_URL}/api/shutdown`, { method: 'POST', timeout: 2000 }, () => {
    killProcess(callback);
  });
  req.on('error', () => killProcess(callback)); // Flask可能已挂
  req.on('timeout', () => {
    req.destroy();
    killProcess(callback);
  });
  req.end();

  function killProcess(cb) {
    if (isKilling) return;
    isKilling = true;
    treeKill(pid, 'SIGKILL', (err) => {
      if (err) log(`Failed to kill: ${err}`);
      else log('Python killed');
      pythonProcess = null;
      if (cb) cb();
    });
  }
};

const quitApplication = () => {
  if (isQuitting) return;
  isQuitting = true;
  exitPythonSubprocess(() => app.quit());
};

const showMainWindow = () => {
  if (!mainWindow) {
    createWindow();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
};

const ensureTray = () => {
  if (tray) return true;

  try {
    tray = new Tray(getTrayIcon());
  } catch (err) {
    log(`Failed to create tray: ${err}`);
    return false;
  }

  tray.setToolTip('选课规划系统');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: quitApplication },
  ]));
  tray.on('click', showMainWindow);
  return true;
};

const minimizeToTray = () => {
  if (ensureTray()) {
    mainWindow?.hide();
  } else {
    mainWindow?.minimize();
  }
};

const handleMainWindowClose = async (event) => {
  if (isQuitting) return;

  event.preventDefault();
  if (isHandlingClose) return;

  if (appSettings.window.closeAction === 'quit') {
    quitApplication();
    return;
  }

  if (appSettings.window.closeAction === 'minimizeToTray') {
    minimizeToTray();
    return;
  }

  isHandlingClose = true;
  let result;
  try {
    result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['退出', '最小化到托盘'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: '退出选课规划系统',
      message: '是否退出选课规划系统？',
      checkboxLabel: '不再询问，记住我的选择',
      checkboxChecked: false,
    });
  } catch (err) {
    log(`Failed to show close confirmation: ${err}`);
    minimizeToTray();
    return;
  } finally {
    isHandlingClose = false;
  }

  if (result.response === 0) {
    if (result.checkboxChecked) {
      setCloseActionPreference('quit');
    }
    quitApplication();
  } else {
    if (result.checkboxChecked) {
      setCloseActionPreference('minimizeToTray');
    }
    minimizeToTray();
  }
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: getAppIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000'); // Frontend Dev Server
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'frontend/dist/index.html'));
    // mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', handleMainWindowClose);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.on('ready', () => {
  startPythonAndCreateWindow();
});

// 显示管理员设置窗口
function showAdminSetupWindow() {
  const genPwd = require('crypto').randomBytes(9).toString('base64url');

  const inputWin = new BrowserWindow({
    width: 500,
    height: 380,
    show: false,
    resizable: false,
    title: '初始设置 - 管理员账号',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  loadUtf8Html(inputWin, `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
      <style>
      body { font-family: 'Microsoft YaHei', 'Noto Sans CJK SC', 'WenQuanYi Micro Hei', sans-serif; padding: 30px; display: flex; flex-direction: column; align-items: center; background: #f5f5f5; }
      .field { width: 80%; margin: 10px 0; }
      .field label { display: block; font-size: 13px; color: #555; margin-bottom: 4px; }
      .field input { width: 100%; padding: 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
      button { padding: 10px 30px; background: #0067c0; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-top: 15px; }
      h3 { color: #333; margin: 0 0 10px 0; }
      .hint { font-size: 12px; color: #999; margin-top: 2px; }
    </style></head>
    <body>
      <h3>首次运行 - 设置管理员账号</h3>
      <div class="field">
        <label>用户名</label>
        <input id="uname" type="text" placeholder="admin" autofocus>
      </div>
      <div class="field">
        <label>密码</label>
        <input id="pwd" type="text" value="${genPwd}">
        <div class="hint">已生成随机密码，可自行修改</div>
      </div>
      <button onclick="submit()">确认创建</button>
      <script>
        function submit() {
          const uname = document.getElementById('uname').value.trim() || 'admin';
          const pwd = document.getElementById('pwd').value.trim();
          if (!pwd) { alert('密码不能为空'); return; }
          if (pwd.length < 6) { alert('密码至少需要6位'); return; }
          require('electron').ipcRenderer.send('admin-credentials', { username: uname, password: pwd });
        }
      </script>
    </body>
    </html>
  `);

  // 通过API创建管理员的辅助函数
  function createAdminViaApi(username, password, callback) {
    const postData = JSON.stringify({ username, password });
    const req = http.request(`${BACKEND_BASE_URL}/api/admin/setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          log(`Admin setup response: ${JSON.stringify(data)}`);
          callback(data.success || false);
        } catch (e) {
          log(`Failed to parse setup response: ${e.message}`);
          callback(false);
        }
      });
    });
    req.on('error', (err) => {
      log(`Admin setup request error: ${err.message}`);
      callback(false);
    });
    req.write(postData);
    req.end();
  }

  let submitted = false;

  ipcMain.once('admin-credentials', (event, creds) => {
    submitted = true;
    inputWin.close();
    createAdminViaApi(creds.username, creds.password, (success) => {
      if (!success) {
        const { dialog } = require('electron');
        dialog.showErrorBox('管理员创建失败',
          '无法创建管理员账号。\n\n可能原因：\n1. 密码长度不足6位\n2. 账号已存在\n3. 后端服务异常');
      }
      createWindow();
    });
  });

  inputWin.on('ready-to-show', () => { inputWin.show(); });

  inputWin.on('closed', () => {
    if (!submitted) {
      createAdminViaApi('admin', genPwd, () => {
        createWindow();
      });
    }
  });
}

// 启动Python并等待Flask就绪
function startPythonAndCreateWindow() {
  startPythonSubprocess();

  const template = [
    {
      label: '学生功能',
      submenu: [
        {
          label: '课程查询',
          click: () => mainWindow?.webContents.send('navigate', '#/student/courses')
        },
        {
          label: '我的课表',
          click: () => mainWindow?.webContents.send('navigate', '#/student/schedule')
        },
        {
          label: '成绩单',
          click: () => mainWindow?.webContents.send('navigate', '#/student/transcript')
        },
        {
          label: '培养方案进度',
          click: () => mainWindow?.webContents.send('navigate', '#/student/progress')
        }
      ]
    },
    {
      label: '管理功能',
      submenu: [
        {
          label: '管理面板',
          click: () => mainWindow?.webContents.send('navigate', '#/admin/dashboard')
        },
        {
          label: '课程与学期管理',
          click: () => mainWindow?.webContents.send('navigate', '#/admin/courses')
        },
        {
          label: '培养方案通用规定',
          click: () => mainWindow?.webContents.send('navigate', '#/admin/general-requirements')
        },
        {
          label: '培养方案管理',
          click: () => mainWindow?.webContents.send('navigate', '#/admin/programs')
        },
        {
          label: '设置',
          click: () => mainWindow?.webContents.send('navigate', '#/admin/students')
        },
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '刷新', role: 'reload' },
        { label: '强制刷新', role: 'forceReload' },
        { type: 'separator' },
        { label: '重置缩放', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '切换全屏', role: 'togglefullscreen' },
        ...(isDev ? [
          { type: 'separator' },
          { label: '开发者工具', role: 'toggleDevTools' }
        ] : [])
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '缩放', role: 'zoom' },
        { label: '关闭', role: 'close' }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  let retries = 0;
  const MAX_RETRIES = 3; // for development, we can retry fewer times before giving up

  const checkServer = () => {
    http.get(`${BACKEND_BASE_URL}/api/health`, (res) => {
      log(`Server ready with status code: ${res.statusCode}`);
      retries = 0; // reset on success
      createWindow();
      return;

      const checkReq = http.get(`${BACKEND_BASE_URL}/api/admin/check-setup`, (checkRes) => {
        let body = '';
        checkRes.on('data', chunk => body += chunk);
        checkRes.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.success && !data.adminExists) {
              log('No admin found, showing setup window');
              showAdminSetupWindow();
            } else {
              log(`Admin exists (${data.username}), creating main window`);
              createWindow();
            }
          } catch (e) {
            log(`Failed to parse check-setup response: ${e.message}`);
            createWindow();
          }
        });
      });
      checkReq.on('error', (err) => {
        log(`Check-setup request failed: ${err.message}`);
        createWindow();
      });
    }).on('error', (err) => {
      retries++;
      log(`Waiting for server... (${retries}/${MAX_RETRIES}) ${err.message}`);
      if (retries >= MAX_RETRIES) {
        // 后端连接超时：显示错误窗口
        const { dialog } = require('electron');
        dialog.showErrorBox('后端服务未启动',
          `无法连接到后端服务 (127.0.0.1:${BACKEND_PORT})。\n\n可能原因：\n1. Python依赖缺失\n2. 端口被占用\n3. 数据库权限不足\n\n请检查日志: ${logFile}`);
        quitApplication();
      } else {
        setTimeout(checkServer, 1000);
      }
    });
  };

  checkServer();
}

app.on('window-all-closed', () => {
  // 主窗口关闭时由 close 事件决定退出或隐藏到托盘。
});

app.on('activate', () => {
  if (mainWindow) {
    showMainWindow();
  } else if (mainWindow === null) {
    createWindow();
  }
});

app.on('will-quit', (event) => {
  if (pythonProcess && !isQuitting) {
    event.preventDefault();
    quitApplication();
  }
});
