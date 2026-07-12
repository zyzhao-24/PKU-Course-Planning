"""Import PKU training-program .xls files into the development SQLite DB.

This script uses the same dev database location as backend/app.py:
    <repo_root>/course_planning.db

Usage:
    python backend/scripts/import_program_xls_to_dev_db.py demo_data/xk_cs.xls
    python backend/scripts/import_program_xls_to_dev_db.py "demo_data/*.xls" --dept 信息科学技术学院
    python backend/scripts/import_program_xls_to_dev_db.py demo_data/xk_cs.xls --name 2024-计算机科学与技术 --year 2024
"""

from __future__ import annotations

import argparse
import glob
import sys
from pathlib import Path
from typing import Iterable, List

from flask import Flask
from sqlalchemy.exc import OperationalError


BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
DEFAULT_DEV_DB_PATH = REPO_ROOT / "course_planning.db"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import db, init_db  # noqa: E402
from models import (  # noqa: E402
    CourseList,
    MainCategory,
    Node,
    Program,
    ProgramCourseOption,
    ProgramMutualExclusionGroup,
    ProgramRequirementRule,
)
from program_xls_parser.db_importer import import_parsed_program  # noqa: E402
from program_xls_parser.parser import parse_xls  # noqa: E402


def main() -> int:
    args = parse_args()
    input_paths = expand_input_paths(args.xls_paths)

    if not input_paths:
        print("No .xls files matched the given input path(s).", file=sys.stderr)
        return 1

    db_path = Path(args.db_path).resolve()
    app = create_import_app(db_path)

    try:
        init_db(app)
    except OperationalError as exc:
        print(
            "Failed to initialize DB. If this is an old course_planning.db, "
            "back it up and delete it so db.create_all() can create the new schema.",
            file=sys.stderr,
        )
        print(str(exc), file=sys.stderr)
        return 1

    with app.app_context():
        for xls_path in input_paths:
            try:
                import_one_file(xls_path, args)
            except Exception as exc:
                db.session.rollback()
                print(f"Failed to import {xls_path}: {exc}", file=sys.stderr)
                return 1

        if args.dry_run:
            db.session.rollback()
            print("Dry run complete. No changes were committed.")

    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import PKU training-program .xls file(s) into the dev SQLite database."
    )
    parser.add_argument(
        "xls_paths",
        nargs="+",
        help="Input .xls path(s). Glob patterns such as demo_data/*.xls are supported.",
    )
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DEV_DB_PATH),
        help=f"SQLite DB path. Defaults to dev DB: {DEFAULT_DEV_DB_PATH}",
    )
    parser.add_argument("--name", help="Override imported Program.name. Only valid for one XLS file.")
    parser.add_argument("--dept", help="Program department value to store in Program.dept.")
    parser.add_argument("--channel", type=int, default=0, help="Program channel. Defaults to 0.")
    parser.add_argument("--year", type=int, help="Override Program.year.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and build DB objects, then roll back instead of committing.",
    )
    args = parser.parse_args()

    if args.name and len(expand_input_paths(args.xls_paths)) > 1:
        parser.error("--name can only be used with a single input file.")

    return args


def create_import_app(db_path: Path) -> Flask:
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path.as_posix()}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    return app


def import_one_file(xls_path: Path, args: argparse.Namespace) -> None:
    parsed = parse_xls(str(xls_path))
    program = import_parsed_program(
        parsed,
        name=args.name,
        dept=args.dept,
        channel=args.channel,
        year=args.year,
        commit=not args.dry_run,
    )

    if args.dry_run:
        db.session.flush()

    stats = collect_import_stats(program.id)
    print(
        f"Imported {xls_path} -> Program(id={program.id}, name={program.name!r}) "
        f"categories={stats['categories']} modules={stats['modules']} "
        f"groups={stats['groups']} options={stats['options']} "
        f"rules={stats['rules']} mutual_exclusions={stats['mutual_exclusions']}"
    )


def collect_import_stats(program_id: int) -> dict:
    category_ids = [
        row.id
        for row in MainCategory.query.with_entities(MainCategory.id)
        .filter_by(program_id=program_id)
        .all()
    ]
    node_ids = []
    if category_ids:
        node_ids = [
            row.id
            for row in Node.query.with_entities(Node.id)
            .filter(Node.main_category_id.in_(category_ids))
            .all()
        ]

    group_count = 0
    if node_ids:
        group_count = CourseList.query.filter(CourseList.node_id.in_(node_ids)).count()

    return {
        "categories": len(category_ids),
        "modules": len(node_ids),
        "groups": group_count,
        "options": ProgramCourseOption.query.filter_by(program_id=program_id).count(),
        "rules": ProgramRequirementRule.query.filter_by(program_id=program_id).count(),
        "mutual_exclusions": ProgramMutualExclusionGroup.query.filter_by(program_id=program_id).count(),
    }


def expand_input_paths(patterns: Iterable[str]) -> List[Path]:
    paths: List[Path] = []
    seen = set()

    for pattern in patterns:
        matches = glob.glob(pattern)
        candidates = matches or [pattern]

        for candidate in candidates:
            path = Path(candidate)
            if not path.exists() or not path.is_file():
                print(f"Skipping missing file: {candidate}", file=sys.stderr)
                continue
            if path.suffix.lower() != ".xls":
                print(f"Skipping non-.xls file: {path}", file=sys.stderr)
                continue

            resolved = path.resolve()
            if resolved not in seen:
                seen.add(resolved)
                paths.append(path)

    return paths


if __name__ == "__main__":
    raise SystemExit(main())
