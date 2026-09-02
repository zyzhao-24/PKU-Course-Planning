# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

选课规划系统 (Course Planning System) — a desktop application for Peking University students to plan courses, track degree progress, manage transcripts, and browse course catalogs. Built as an Electron shell that spawns a Flask backend, with a React frontend.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron v39 |
| Frontend | React 18 + React Router 7 (HashRouter), Vite 5 |
| Backend | Flask (Python), gevent WSGI server (production) |
| ORM/Database | SQLAlchemy + Flask-SQLAlchemy, SQLite (`course_planning.db`) |
| Auth | PKU IAAA OAuth (students), bcrypt (admins), JWT (HS256), RSA-OAEP |
| PDF Export | Playwright (Chromium headless) |
| Packaging | PyInstaller (backend → .exe) + electron-builder (NSIS installer) |

## Commands

### Development

```bash
# Install frontend dependencies
cd frontend && npm install

# Install root/Electron dependencies
cd .. && npm install

# Install Python dependencies
pip install flask flask-sqlalchemy flask-cors cryptography playwright sqlalchemy pycryptodome pyinstaller

# Run full dev mode (Vite HMR on :3000 + Flask on :5000 + Electron)
npm run dev

# Run only the frontend dev server
npm run dev:frontend

# Run only Electron (waits for :3000 to be ready)
npm run dev:electron
```

In dev mode, Vite proxies `/api/*` requests to Flask at `http://127.0.0.1:5000`. Flask runs in debug mode with auto-reload. Electron loads `http://localhost:3000`.

### Production Build

```bash
# One-click full build (PyInstaller + Vite + electron-builder)
.\dist.bat

# Or step by step:
cd backend && pyinstaller --noconfirm app.spec   # Build Flask to .exe
cd frontend && npm run build                       # Build React to static files
npm run dist                                       # electron-builder NSIS installer
npm run pack                                       # Unpacked version only (no installer)
```

Output: `dist/CoursePlanningSystem Setup 1.0.0.exe` (~316 MB installer).

### Testing

No test framework is configured. The `test` script in root `package.json` is a placeholder.

## Architecture

### Process Model

```
Electron main process (main.js)
  ├── spawns Flask as child process (python app.py in dev, app.exe in production)
  ├── creates BrowserWindow loading localhost:3000 (dev) or file:// (production)
  └── manages lifecycle: polls Flask /api/health until ready, kills on exit
```

The Flask backend serves **both** the REST API and static frontend files. In production, Flask uses `send_from_directory` to serve `frontend/dist/`; in dev, Vite handles the frontend separately.

### Frontend Architecture

- **Entry**: [frontend/src/main.jsx](frontend/src/main.jsx) — renders `<App />`, listens for Electron IPC `navigate` events
- **Routing**: [frontend/src/App.jsx](frontend/src/App.jsx) — HashRouter with `ProtectedRoute` guards checking `user.role`
- **State**: React Context API only (no Redux):
  - `AuthContext` — user object, JWT token, `isAuthenticated`
  - `SemesterContext` — current semester, semester list, `first_week_monday`
- **API client**: [frontend/src/utils/axios.js](frontend/src/utils/axios.js) — Axios instance with JWT interceptor; auto-redirects to login on 401
- **Styling**: Plain CSS files co-located with components (no UI framework)

Routes:
- `/login` — public login page
- `/student/courses` — browse/search courses
- `/student/schedule` — weekly timetable view
- `/student/transcript` — grade records
- `/student/progress` — degree program progress tracking
- `/admin/dashboard` — admin overview
- `/admin/courses` — course catalog management
- `/admin/programs` — degree program list
- `/admin/programs/:id` — program editor (tree-based requirement structure)
- `/admin/students` — student management
- `/admin/semester-config` — semester configuration

### Backend Architecture

- **Entry**: [backend/app.py](backend/app.py) — Flask app creation, CORS, SQLAlchemy init, blueprint registration, all non-program API routes
- **Production server**: [backend/server.py](backend/server.py) — gevent WSGI server with auto-generated self-signed SSL cert on port 5000
- **Auth**: [backend/auth_utils.py](backend/auth_utils.py) — JWT generation/verification, decorators (`@login_required`, `@student_required`, `@admin_required`), PKU IAAA portal session management, SMS/QR login flows
- **Encryption**: [backend/secure_auth.py](backend/secure_auth.py) — RSA-OAEP key pair generation, credential decryption
- **Models**: [backend/models.py](backend/models.py) — 14 SQLAlchemy models (User, Program, MainCategory, Node, CourseList, CourseListAssignment, Semester, Course, SelectedCourse, Transcript, ExchangeTranscript, DissertationTranscript, CourseNameMapping)
- **Program system**: [backend/program_api.py](backend/program_api.py) — Flask Blueprint for degree program CRUD + student progress APIs
- **Progress engine**: [backend/program_calculator.py](backend/program_calculator.py) — strict-priority course-to-requirement matching algorithm
- **Data import**: [backend/importer.py](backend/importer.py) — course data importer from JSON files
- **Portal**: [backend/client.py](backend/client.py) — PKU IAAA OAuth login client; [backend/publicQuery.py](backend/publicQuery.py) — fetches scores and schedules from university portal

API response convention: all endpoints return `{ success: bool, data/message, ... }`.

### The Degree Progress Algorithm (`program_calculator.py`)

This is the most architecturally significant module. Key design:

1. **CourseListAssignment** stores only non-repeatable list assignments (`course_list_id` can be NULL for unassigned)
2. **Repeatable lists** are computed on-the-fly (not stored in DB)
3. **Strict priority matching**: course_id (0) > type (1) > department (2) > teacher (3) > elective (4) > no-match (5)
4. For non-repeatable lists: find the best list for each course
5. For repeatable lists: find the best courses for each list
6. Channels are tracked separately: `channel=0` (major/主修) and `channel=1` (minor/辅双)

Key classes: `PriorityMatcher`, `NonRepeatableDistributor`, `RepeatableCalculator`, `ProgramProgressCalculator`.

The `/api/student/progress` endpoint **reads only** (no auto-reassignment). The `/api/student/progress/recalculate` endpoint clears assignments and re-runs the full algorithm.

### Database

SQLite single file (`course_planning.db`, ~4.7 MB, pre-seeded with course data). No migration tool — `db.create_all()` in `init_db()` auto-creates tables. `CourseListAssignment` has a UNIQUE constraint on `(user_id, source_type, source_uuid)`.

### Data Pipeline

Standalone scripts in `scripts/course_data/` for populating the course database:
- [scripts/course_data/crawl_courses.py](scripts/course_data/crawl_courses.py) — async crawler hitting `dean.pku.edu.cn` to fetch course listings
- [scripts/course_data/format_courses.py](scripts/course_data/format_courses.py) — converts raw crawled JSON into standardized format

These are run offline to produce JSON files in `scripts/course_data/courses/`, which are then imported via `importer.py`. Generated raw and formatted data are ignored by Git.

## Key Patterns

- **Hardcoded secrets** exist for dev convenience: JWT secret in `auth_utils.py:20`, default admin password in `app.py`. These are not intended for production deployment outside the local desktop context.
- **Electron IPC**: the main process sends `navigate` events for menu-based navigation; the React app listens via `window.electronAPI.onNavigate()` in `main.jsx`.
- **Frontend production detection**: `import.meta.env.DEV` vs checking `window.location.protocol` for HTTPS to determine API base URL.
- **RSA key pairs** for login encryption are generated per-session and stored in memory only (not in DB).
