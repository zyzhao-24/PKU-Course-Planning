import json
import sys
import unittest
from pathlib import Path

from flask import Flask

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import db
from models import (  # noqa: E402
    CourseList,
    MainCategory,
    Node,
    Program,
    ProgramCourseOption,
    ProgramMutualExclusionGroup,
    ProgramMutualExclusionItem,
    ProgramRequirementRule,
)
from program_xls_parser.db_importer import import_parsed_program  # noqa: E402


REPO_ROOT = Path(__file__).resolve().parents[2]
PARSED_JSON = REPO_ROOT / "demo_data" / "xk_cs.parsed.json"


class ProgramDbImporterTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        self.app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
        db.init_app(self.app)
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.ctx.pop()

    def test_create_all_includes_program_extension_tables(self):
        inspector = db.inspect(db.engine)
        table_names = set(inspector.get_table_names())

        self.assertIn("program_course_options", table_names)
        self.assertIn("program_requirement_rules", table_names)
        self.assertIn("program_mutual_exclusion_groups", table_names)
        self.assertIn("program_mutual_exclusion_items", table_names)

    def test_import_xk_parsed_json_preserves_structure(self):
        parsed = json.loads(PARSED_JSON.read_text(encoding="utf-8"))
        program = import_parsed_program(parsed, dept="计算机学院", channel=0, commit=True)

        self.assertIsNotNone(program.id)
        self.assertEqual(Program.query.count(), 1)
        self.assertEqual(MainCategory.query.count(), 3)
        self.assertEqual(Node.query.count(), 13)
        self.assertEqual(CourseList.query.count(), 20)
        self.assertEqual(ProgramCourseOption.query.count(), 102)
        self.assertEqual(ProgramRequirementRule.query.count(), 5)
        self.assertEqual(ProgramMutualExclusionGroup.query.count(), 26)
        self.assertGreater(ProgramMutualExclusionItem.query.count(), 26)

        self.assertEqual(program.total_credits, 140)
        self.assertEqual(program.source_info["filename"], "xk_cs.xls")
        self.assertTrue(program.raw_payload["categories"])

        category = MainCategory.query.filter_by(name="公共基础课程").first()
        self.assertIsNotNone(category)
        self.assertEqual(category.requirement_raw, "45-51")
        self.assertEqual(category.requirement_type, "credits")
        self.assertEqual(category.requirement_min, 45)
        self.assertEqual(category.requirement_max, 51)

        option = ProgramCourseOption.query.filter_by(course_id="04830041").first()
        self.assertIsNotNone(option)
        self.assertEqual(option.course_name, "计算概论A")
        self.assertEqual(option.credits, 3)
        self.assertIn("excel_row", option.raw_payload)

        exclusion = ProgramMutualExclusionGroup.query.first()
        self.assertIsNotNone(exclusion.raw)
        self.assertEqual(exclusion.strategy["scope"], "program")
        self.assertGreaterEqual(len(exclusion.items), 2)

    def test_rule_table_can_locate_cross_group_targets(self):
        parsed = json.loads(PARSED_JSON.read_text(encoding="utf-8"))
        import_parsed_program(parsed, commit=True)

        rule = ProgramRequirementRule.query.filter(
            ProgramRequirementRule.target_names != []
        ).first()

        self.assertIsNotNone(rule)
        self.assertIn(rule.metric, {"credits", "courses"})
        self.assertEqual(rule.operator, ">=")
        self.assertGreater(len(rule.target_names), 0)


if __name__ == "__main__":
    unittest.main()
