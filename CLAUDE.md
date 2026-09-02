# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

选课规划系统 (Course Planning System) — a desktop application for Peking University students to plan courses, track degree progress, manage transcripts, and browse course catalogs. Built as an Electron shell that spawns a Flask backend, with a React frontend.

> This is an unofficial helper tool, not affiliated with Peking University's course registration system. All planning results are for reference only.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron v39 |
| Frontend | React 18 + React Router 7 (HashRouter), Vite 5 |
| Backend | Flask (Python), gevent WSGI server (`server.py`) |
| ORM/Database | SQLAlchemy + Flask-SQLAlchemy, SQLite (`course_planning.db`) |
| Auth | Local auto-user + PKU IAAA portal session for sync, JWT (HS256), RSA-OAEP |
| PDF Export | Playwright (Chromium headless) |
| Packaging | PyInstaller (backend → .exe) + electron-builder (NSIS installer) |

## Commands

### Development

```powershell
# Create and activate a Python virtual environment (recommended)
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
python -m playwright install chromium

# Install Node dependencies
npm install
npm install --prefix frontend

# Run full dev mode (Vite HMR on :3000 + Flask on :5001 + Electron)
npm run dev

# Run only the frontend dev server
npm run dev:frontend

# Run only Electron (waits for :3000 to be ready)
npm run dev:electron
```

In dev mode, Vite proxies `/api/*` requests to Flask at `http://127.0.0.1:5001`. Flask runs in debug mode with auto-reload. Electron loads `http://localhost:3000`.

### Production Build

```powershell
# One-click full build (PyInstaller + Vite + electron-builder)
.\dist.bat

# Or step by step:
cd backend && pyinstaller --noconfirm app.spec   # Build Flask to .exe
cd frontend && npm run build                       # Build React to static files
npm run dist                                       # electron-builder NSIS installer
npm run pack                                       # Unpacked version only (no installer)
```

Output: `dist/CoursePlanningSystem Setup 1.0.0.exe` (~316 MB installer).

`backend/app.spec` records the Playwright browser resource paths that must be bundled. If Playwright is upgraded or downgraded, verify the actual directory name under `%LOCALAPPDATA%\ms-playwright` and update `app.spec` accordingly.

### Testing

```powershell
# Backend unit tests
python -m unittest discover -s backend -p "test_*.py"

# Frontend utility tests
node --test frontend/src/utils/*.test.js

# Frontend lint
npm run lint --prefix frontend
```

## Architecture

### Process Model

```
Electron main process (main.js)
  ├── spawns Flask as child process (python app.py in dev, app.exe in production)
  ├── creates BrowserWindow loading localhost:3000 (dev) or file:// (production)
  └── manages lifecycle: polls Flask /api/health until ready, kills on exit
```

The Flask backend serves **both** the REST API and static frontend files. In production, Flask uses `send_from_directory` to serve `frontend/dist/`; in dev, Vite handles the frontend separately.

Port convention:

- Dev backend: `127.0.0.1:5001` (`main.js` line 29, `app.py` `__main__` block, `vite.config.js` proxy)
- Production backend: `127.0.0.1:5000`
- Dev frontend: `localhost:3000`

### Frontend Architecture

- **Entry**: [frontend/src/main.jsx](frontend/src/main.jsx) — renders `<App />`, listens for Electron IPC `navigate` events
- **Routing**: [frontend/src/App.jsx](frontend/src/App.jsx) — HashRouter; most routes live under `/<student|admin>/...`; `/admin/dashboard` and `/admin/semester-config` redirect to `/admin/courses`
- **State**: React Context API only (no Redux):
  - `AuthContext` — local user object, JWT token, `isAuthenticated`
  - `SemesterContext` — current semester, semester list, `first_week_monday`
  - `ActivityContext` — student-owned schedule activities
- **API client**: [frontend/src/utils/axios.js](frontend/src/utils/axios.js) — Axios instance with JWT interceptor; auto-redirects to login on 401
- **Styling**: Plain CSS files co-located with components (no UI framework)

Routes:

- `/login` — public login page (redirects to student courses once authenticated)
- `/student/courses` — browse/search courses
- `/student/schedule` — weekly timetable view
- `/student/transcript` — grade records
- `/student/progress` — degree program progress tracking
- `/admin/courses` — course catalog and semester management
- `/admin/general-requirements` — college English, labor education, and physical education pools
- `/admin/programs` — degree program list
- `/admin/programs/:id` — program editor (tree-based requirement structure)
- `/admin/students` — student management and program assignment

### Backend Architecture

- **Entry**: [backend/app.py](backend/app.py) — Flask app creation, CORS, SQLAlchemy init, blueprint registration, course/transcript/sync/base admin API routes
- **Production server**: [backend/server.py](backend/server.py) — gevent WSGI server with auto-generated self-signed SSL cert on port 5000
- **Auth**: [backend/auth_utils.py](backend/auth_utils.py) — JWT generation/verification, decorators (`@login_required`, `@student_required`, `@admin_required`), PKU IAAA portal session management, password/QR/SMS login flows
- **Encryption**: [backend/secure_auth.py](backend/secure_auth.py) — RSA-OAEP key pair generation, credential decryption
- **Models**: [backend/models.py](backend/models.py) — SQLAlchemy models including User, Program, MainCategory, Node, CourseList, CourseListAssignment, ProgramCourseOption, ProgramRequirementRule, ProgramMutualExclusionGroup/Item, Semester, Course, SelectedCourse, Transcript, ExchangeTranscript, DissertationTranscript, ScheduleActivity, ScheduleAdjustment/Entry, CourseNameMapping, CollegeEnglishCoursePool, LaborEducationCoursePool
- **Program system**: [backend/program_api.py](backend/program_api.py) — Flask Blueprint for degree program CRUD + student progress APIs
- **Progress engine**: [backend/program_calculator.py](backend/program_calculator.py) — strict-priority course-to-requirement matching algorithm
- **Special requirements**: [backend/college_english.py](backend/college_english.py), [backend/physical_education.py](backend/physical_education.py), [backend/labor_education.py](backend/labor_education.py) — handle university-wide requirement pools
- **Activities / calendar**: [backend/activity_api.py](backend/activity_api.py) — student custom activities; [backend/schedule_adjustment_api.py](backend/schedule_adjustment_api.py) — semester calendar adjustments (substitute days, cancellations)
- **Data import**: [backend/importer.py](backend/importer.py) — course data importer from JSON files; [backend/program_xls_parser/](backend/program_xls_parser/) — undergraduate school `.xls` program parser and DB importer
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
7. Special generated lists exist for college English modules (`raw` starts with `college_english:`)

Key classes: `PriorityMatcher`, `NonRepeatableDistributor`, `RepeatableCalculator`, `ProgramProgressCalculator`, `CourseMoveManager`, `CourseInfoResolver`.

The `/api/student/progress` endpoint **reads only** (no auto-reassignment). The `/api/student/progress/recalculate` endpoint clears assignments and re-runs the full algorithm. Students can also move a course between non-repeatable lists via `/api/student/courses/move`.

### Database

SQLite single file (`course_planning.db`, pre-seeded with course data). No migration tool — `db.create_all()` in `init_db()` auto-creates tables. `CourseListAssignment` has a UNIQUE constraint on `(user_id, source_type, source_uuid)`.

Course names and credits are normalized in `CourseNameMapping` (`course_id` primary key); `Course` stores only per-class data. `Course.credits` and `Course.course_name` are read-only properties that look up `CourseNameMapping`.

### Data Pipeline

Standalone scripts for populating the course database:
- [scripts/course_data/crawl_courses.py](scripts/course_data/crawl_courses.py) — async crawler hitting `dean.pku.edu.cn` to fetch course listings
- [scripts/course_data/format_courses.py](scripts/course_data/format_courses.py) — converts raw crawled JSON into standardized format

These produce JSON files in `scripts/course_data/courses/`, which are then imported via `backend/importer.py`. Generated raw and formatted data are ignored by Git.

Program `.xls` files are parsed by [backend/program_xls_parser/parser.py](backend/program_xls_parser/parser.py) and imported by [backend/program_xls_parser/db_importer.py](backend/program_xls_parser/db_importer.py).

## Key Patterns

- **Local user model**: The app uses a single automatic local user (`/api/auth/local-session`). The first-run admin setup window in `main.js` is legacy UI; the backend's `/api/admin/setup` endpoint now returns 410 and `/api/admin/check-setup` always reports an admin exists. There is no default admin password.
- **JWT secret**: generated once and persisted to `backend/.jwt_secret`.
- **Electron IPC**: the main process sends `navigate` events for menu-based navigation; the React app listens via `window.electronAPI.onNavigate()` in `main.jsx`.
- **Frontend production detection**: `import.meta.env.DEV` vs checking `window.location.protocol` for HTTPS to determine API base URL.
- **RSA key pairs** for login encryption are generated per-session and stored in memory only (not in DB).
- **Portal connection is only required for sync**: syncing transcripts (`/api/student/transcript/sync`) and schedules (`/api/student/schedule/sync`) requires an active PKU portal session. Local planning, course import, and program editing do not require portal login.
