# PKU Course Planning

一个面向北京大学学生的本地桌面课程规划工具，用于管理课程与成绩、查看课表、检查时间冲突，并按照主修或辅修/双学位培养方案估算完成进度。

> [!IMPORTANT]
> 本项目是非官方辅助工具，与北京大学选课系统无关，不能代替正式选课、官方成绩单或院系毕业审核。所有结果仅供规划参考，请以学校和院系发布的信息为准。

## 使用方法

### 1. 使用已构建版本

如果你拿到的是 Windows 安装包：

1. 运行 `CoursePlanningSystem Setup 1.0.0.exe` 并完成安装。
2. 启动 CoursePlanningSystem。应用会自动创建本地用户和本地数据库，无需注册。
3. 进入“课程与学期”，创建学期并导入符合系统格式的课程 JSON。
4. 进入“方案管理”，选择“主修”或“辅修/双学位”类型，然后导入从`门户-教务部业务-培养方案-查看教学计划`下载的培养方案 `.xls` 文件。
5. 进入“设置”，选择自己的主修方案、辅修/双学位方案和大学英语分级。
6. 在“成绩单”中手动维护成绩，或在需要同步时连接北京大学账号；随后可在“培养方案”页面重新计算完成进度。

课表和成绩同步需要临时连接北京大学账号。普通的本地规划、课程导入和培养方案编辑不要求登录北京大学账号。

### 2. 从源码运行

目前的桌面构建和打包流程主要面向 Windows。开发环境建议使用：

- Windows 10/11
- Node.js 20 或更高版本
- Python 3.11 或更高版本
- npm

克隆仓库后，在 PowerShell 中执行：

```powershell
git clone <repository-url>
cd PKU-Course-Planning

python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
python -m playwright install chromium

npm install
npm install --prefix frontend
npm run dev
```

`npm run dev` 会同时执行以下操作：

- 在 `http://localhost:3000` 启动 Vite 开发服务器；
- 在 `http://127.0.0.1:5001` 启动 Flask API；
- 打开 Electron 桌面窗口。

SQLite 数据库默认保存在项目根目录的 `course_planning.db`。首次启动时会自动建表，并初始化大学英语和劳动教育课程池。

如果 PowerShell 禁止执行虚拟环境激活脚本，可以在当前用户范围允许本地脚本后重试：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### 3. 推荐的首次配置流程

#### 导入课程数据

打开“课程与学期”：

1. 选择已有学期，或者填写学年、学期和第一周周一来创建新学期。
2. 导入对应学期的课程 JSON。需要自行生成数据时，可使用 `scripts/course_data/` 下的抓取和格式化工具。
3. 已有学期可以选择“追加”或“覆盖”导入。
4. 如有调课、停课或调休安排，可在同一页面维护教学日历调整。

#### 导入培养方案

打开“方案管理”：

1. 先选择方案类型：主修或辅修/双学位。
2. 上传从本科生院下载的 `.xls` 培养方案；支持一次选择多个文件。
3. 检查导入预览和警告，然后按需编辑课程组、候选课程、要求规则及互斥规则。

当前集成的培养方案导入器只接受 `.xls` 文件。

#### 维护个人数据

- 在“设置”中选择培养方案和大学英语分级。
- 在“成绩单”中连接北京大学账号进行同步，或者手动添加、修改课程成绩。
- 在“选课”和“我的课表”中规划课程；系统会检查课程、考试及自定义活动之间的时间冲突。
- 在“培养方案”中查看主修与辅修/双学位进度，并在数据变化后重新计算。

## 项目框架

项目采用 Electron + React + Flask + SQLite 的本地桌面架构：

```text
Electron 主进程（main.js）
├── 启动并管理 React/Vite 界面
├── 启动并关闭 Flask 子进程
├── 提供托盘、窗口和应用设置能力
└── 通过 preload.js 暴露有限的桌面 API
          │
          ▼
React 前端（frontend/src）
          │  Axios / HTTP API
          ▼
Flask 后端（backend）
├── 认证与 PKU Portal 同步
├── 课程、成绩单和课表 API
├── 培养方案导入与进度计算
├── 活动和教学日历调整 API
└── SQLAlchemy 数据模型
          │
          ▼
SQLite（course_planning.db）
```

### 前端

前端位于 `frontend/`，使用 React、React Router、Axios 和 Vite。

- `src/pages/`：选课、课表、成绩单、培养方案及管理页面。
- `src/components/`：课程表、培养方案预览、活动编辑、冲突确认和 Portal 连接等组件。
- `src/contexts/`：本地会话、当前学期和自定义活动状态。
- `src/utils/`：学期排序、成绩展示、课表时间与冲突计算等通用逻辑。

开发环境中，Vite 会把 `/api` 请求代理到 Flask 的 `5001` 端口。

### 后端

后端位于 `backend/`，使用 Flask、SQLAlchemy 和 SQLite。

- `app.py`：应用入口，以及课程、成绩单、同步和基础管理 API。
- `models.py`：用户、课程、学期、培养方案、成绩单、活动和调课规则等数据模型。
- `program_api.py`：培养方案的导入、编辑、查询和个人方案设置 API。
- `program_calculator.py`：课程匹配、分配和培养方案完成度计算。
- `program_xls_parser/`：本科生院培养方案 `.xls` 的解析与数据库导入。
- `activity_api.py`：学生自定义活动的增删改查与校验。
- `schedule_adjustment_api.py`：调课、停课和教学日历调整。
- `auth_utils.py`、`client.py`：本地会话及北京大学 Portal 连接流程。

### 桌面层与数据

- `main.js`：Electron 主进程，负责 Flask 生命周期、窗口、托盘、日志和应用设置。
- `preload.js`：Electron 主进程与 React 渲染进程之间的受限桥接层。
- `app-settings.json`：开发环境的窗口关闭行为等桌面设置。
- `data/college_english_pool.json`、`data/labor_education_pool.json`：通用要求的默认课程池。
- `scripts/course_data/`：课程数据抓取和格式化工具；生成的 `raw/` 与 `courses/` 目录不会提交到 Git。

## 测试

运行后端单元测试：

```powershell
python -m unittest discover -s backend -p "test_*.py"
```

运行前端工具函数测试：

```powershell
node --test frontend/src/utils/*.test.js
```

执行前端代码检查和生产构建：

```powershell
npm run lint --prefix frontend
npm run build:frontend
```

## 构建 Windows 安装包

先安装构建工具并准备 Playwright Chromium：

```powershell
python -m pip install pyinstaller
python -m playwright install chromium
```

`backend/app.spec` 中记录了需要打包的 Playwright 浏览器资源目录。若升级或降级 Playwright，请先确认 `%LOCALAPPDATA%\ms-playwright` 下的实际目录名，并同步更新 `app.spec` 中的对应路径。

然后执行：

```powershell
.\dist.bat
```

构建流程依次生成 Flask 可执行文件、React 静态资源和 Electron 安装包。主要输出目录为：

- `backend/dist/app/`：打包后的 Flask 后端；
- `frontend/dist/`：React 静态资源；
- `dist/`：Electron 便携目录和 NSIS 安装包。

## 技术栈

- 桌面端：Electron
- 前端：React、React Router、Vite、Axios
- 后端：Flask、Flask-SQLAlchemy
- 数据库：SQLite
- Portal 自动化：Playwright
- 打包：PyInstaller、electron-builder、NSIS

## License

ISC
