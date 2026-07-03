# 选课规划系统 (Course Planning System) v3.0

## 项目概述

选课规划系统是一个基于 Electron + Flask 的桌面应用程序，用于帮助学生规划课程、管理培养方案进度。

### 技术栈

- **前端**: React + Vite
- **后端**: Flask (Python)
- **桌面**: Electron
- **数据库**: SQLite
- **打包**: PyInstaller + electron-builder

## 系统架构

### 核心模块

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 主进程                        │
│                      (main.js)                           │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │   前端界面   │◄──►│  Flask后端  │◄──►│  SQLite DB  │ │
│  │  (React)    │    │   (Python)  │    │             │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 后端模块说明

#### 1. 培养方案计算引擎 (`program_calculator.py`)

**核心设计原则**:
- `CourseListAssignment` 只存储不可重复列表的归属（`course_list_id` 可为空表示未分配）
- 可重复列表当场计算，不存储
- 严格优先级匹配：课号(0) > 类型(1) > 院系(2) > 教师(3) > 任选(4) > 不匹配(5)
- 为课程找最优列表（不可重复），为列表找最优课程（可重复）

**主要类**:
- `PriorityMatcher`: 严格优先级匹配器
- `NonRepeatableDistributor`: 不可重复列表分配器
- `RepeatableCalculator`: 可重复列表计算器
- `ProgramProgressCalculator`: 培养方案进度计算器入口

#### 2. 培养方案 API (`program_api.py`)

**管理端 API**:
- `/api/admin/programs` - 培养方案 CRUD
- `/api/admin/categories` - 主类别管理
- `/api/admin/nodes` - 节点管理
- `/api/admin/course-lists` - 课程列表管理

**学生端 API**:
- `GET /api/student/progress` - 获取培养方案进度（不自动重新分配）
- `POST /api/student/progress/recalculate` - 重新计算并自动分配
- `POST /api/student/courses/move` - 移动/取消分配课程
- `POST /api/student/courses/can-move` - 查询可移动目标列表

#### 3. 模型定义 (`models.py`)

**核心模型**:
- `User` - 用户（学生/管理员）
- `Program` - 培养方案
- `MainCategory` - 主类别（公共基础课/专业必修/专业选修）
- `Node` - 节点（树状结构）
- `CourseList` - 课程列表
- `CourseListAssignment` - 课程归属记录
- `Transcript` - 成绩单
- `SelectedCourse` - 已选课程

## 关键功能实现

### 1. 培养方案进度计算

**查询进度 (`/api/student/progress`)**:
- 只读取现有分配，不自动重新分配
- 返回主修和辅双两个通道的进度

**重新计算 (`/api/student/progress/recalculate`)**:
- 清除所有现有分配
- 为每个课程找到最优的不可重复列表
- 可重复列表当场计算
- 为所有课程创建数据库记录（包括未分配的）

### 2. 课程分配算法

**不可重复列表分配**:
1. 获取所有不可重复列表（按 `order_index` 排序）
2. 对每个课程，遍历所有列表找到最优匹配
3. 使用内存计数跟踪列表已满状态
4. 保存所有课程的分配结果（包括未分配的）

**可重复列表计算**:
1. 当场计算，不存储到数据库
2. 筛选满足条件的所有课程
3. 按匹配层级排序，应用 `max_courses` 限制

### 3. 课程移动/取消分配

**取消分配**:
- 支持几乎所有本通道课程取消分配
- 如果没有分配记录，自动创建一条未分配记录
- 设置 `course_list_id = NULL`

**移动到其他列表**:
- 只允许移动到不可重复列表
- 检查目标列表是否已满
- 检查课程是否匹配目标列表的筛选条件

### 4. 未分配课程区域

- 只显示当前通道的课程
- 通过 `Transcript.channel` 和 `SelectedCourse.channel` 过滤
- 显示在培养方案进度页面底部

## 数据库结构

### CourseListAssignment 表

```sql
CREATE TABLE course_list_assignments (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    course_list_id INTEGER,  -- NULL 表示未分配
    source_type VARCHAR(20) DEFAULT 'course',  -- 'course', 'exchange_course', 'dissertation'
    source_uuid VARCHAR(50),  -- 执行计划编号
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, source_type, source_uuid)
);
```

## 构建说明

### 环境要求

- Node.js 18+
- Python 3.11+
- PyInstaller
- electron-builder

### 依赖安装

```bash
# 前端依赖
cd frontend && npm install

# 后端依赖
pip install flask flask-sqlalchemy flask-cors cryptography playwright sqlalchemy pycryptodome pyinstaller

# Electron 依赖
npm install
```

### 构建流程

```bash
# 一键完整构建
.\dist.bat

# 或分步执行
# 1. 构建后端
cd backend && pyinstaller --noconfirm app.spec

# 2. 构建前端
cd frontend && npm run build

# 3. Electron 打包
npm run dist
```

### 构建输出

- `backend/dist/app/` - Python 可执行文件
- `frontend/dist/` - 前端静态资源
- `dist/CoursePlanningSystem Setup 1.0.0.exe` - 安装程序
- `dist/win-unpacked/` - 便携版本

## 配置文件

### `backend/app.spec`
PyInstaller 配置文件，定义如何打包后端应用。

### `package.json`
包含 Electron Builder 配置：
- `build.files` - 包含的文件
- `build.extraResources` - 额外资源（后端可执行文件）
- `build.nsis` - NSIS 安装程序配置

### `installer.nsh`
NSIS 安装程序脚本，定义安装时创建的快捷方式。

## API 文档

### 培养方案系统 API

#### 获取学生进度
```
GET /api/student/progress
Authorization: Bearer <token>

Response:
{
  "success": true,
  "progress": {
    "major": {  // 主修方案
      "program_id": 1,
      "program_name": "计算机科学与技术",
      "categories": [...],
      "is_qualified": false,
      "total_credits": 45.5,
      "total_courses": 15,
      "unassigned_courses": [...]
    },
    "minor": null  // 辅双方案（未分配时为null）
  }
}
```

#### 重新计算进度
```
POST /api/student/progress/recalculate
Authorization: Bearer <token>

Response:
{
  "success": true,
  "message": "Recalculation completed"
}
```

#### 移动课程
```
POST /api/student/courses/move
Authorization: Bearer <token>
Content-Type: application/json

{
  "source_uuid": "课程执行计划编号",
  "to_list_id": 123,  // null 表示取消分配
  "channel": 0  // 0=主修, 1=辅双
}

Response:
{
  "success": true,
  "message": "移动成功"
}
```

#### 查询可移动目标
```
POST /api/student/courses/can-move
Authorization: Bearer <token>
Content-Type: application/json

{
  "source_uuid": "课程执行计划编号",
  "channel": 0
}

Response:
{
  "success": true,
  "target_lists": [
    {
      "id": 123,
      "name": "专业核心课",
      "full_path": "专业必修 > 核心课程 > 专业核心课",
      "match_level": 0,
      "max_courses": 10
    }
  ],
  "can_unassign": true
}
```

## 开发说明

### 添加新的 API

1. 在 `program_api.py` 中定义路由
2. 使用 `@student_required` 或 `@admin_required` 装饰器保护
3. 返回标准格式：`{"success": true/false, "data": ..., "message": "..."}`

### 修改分配算法

1. 修改 `PriorityMatcher.get_match_level()` 调整匹配优先级
2. 修改 `NonRepeatableDistributor.distribute()` 调整分配逻辑
3. 确保 `recalculate()` 调用时传入 `auto_distribute=True`

### 前端调用后端

前端通过 `fetch` 或 axios 调用后端 API：

```javascript
const response = await fetch('/api/student/progress', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const data = await response.json();
```

## 常见问题

### Q: 为什么查看进度时课程分配没有变化？
A: `/api/student/progress` 只读取现有分配，不会自动重新分配。如需重新分配，请调用 `/api/student/progress/recalculate`。

### Q: 为什么某些课程无法取消分配？
A: 只有本通道的课程可以取消分配。如果课程不在当前通道（主修/辅双）的成绩单或已选课程中，则无法操作。

### Q: 重新分配后为什么某些课程变为未分配？
A: 重新分配时会根据当前所有课程重新计算最优分配。如果课程不再匹配任何列表的筛选条件，或所有匹配的列表已满，则会变为未分配。

## 版本历史

### v3.0 (当前)
- 重写培养方案计算引擎
- 严格优先级匹配算法
- 支持课程移动和取消分配
- 未分配课程区域
- 区分主修/辅双通道

### v2.0
- 添加培养方案管理功能
- 课程列表筛选

### v1.0
- 基础选课功能
- 成绩单管理

## 许可证

ISC License