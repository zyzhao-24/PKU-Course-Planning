import sys
import unittest
from pathlib import Path

from flask import Flask

BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from database import db  # noqa: E402
from labor_education import seed_default_pool  # noqa: E402
from models import (  # noqa: E402
    Course,
    CourseList,
    CourseListAssignment,
    CourseNameMapping,
    LaborEducationCoursePool,
    MainCategory,
    Node,
    Program,
    Transcript,
    User,
)
from program_calculator import ProgramProgressCalculator  # noqa: E402
from format_labor_education import parse_source  # noqa: E402


class LaborEducationProgressTest(unittest.TestCase):
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

    def add_course(self, user, index, course_id, credits=2.0):
        source_uuid = f"labor-course-{index}"
        db.session.add(CourseNameMapping(
            course_id=course_id,
            course_name=f"课程 {index}",
            credits=credits,
        ))
        db.session.add(Course(
            uuid=source_uuid,
            course_id=course_id,
            course_type="专业必修",
            department_code="00001",
            class_number=str(index),
            semester="26-27-1",
            class_times=[],
            teachers=[],
        ))
        db.session.add(Transcript(
            record_id=f"labor-record-{index}",
            user_id=user.id,
            uuid=source_uuid,
            course_id=course_id,
            class_number=str(index),
            academic_year="26-27",
            term=1,
            course_name=f"课程 {index}",
            score="90",
            score_type="Percentage",
            credits=credits,
            channel=0,
        ))
        return source_uuid

    def create_program(self, with_labor_node=False, year=2021):
        program = Program(name="劳动教育测试方案", dept="测试", channel=0, year=year)
        db.session.add(program)
        db.session.flush()
        category = MainCategory(program_id=program.id, name="公共基础课程", order_index=0)
        db.session.add(category)
        db.session.flush()
        if with_labor_node:
            db.session.add(Node(
                main_category_id=category.id,
                name="劳动教育课",
                order_index=0,
                requirement_type="hours",
                requirement_min=32,
                requirement_max=None,
            ))
        db.session.flush()
        return program, category

    def test_parser_splits_fields_and_preserves_non_numeric_id(self):
        entries, warnings = parse_source(
            "1 04031861马克思主义学院新时代劳动理论全校公选课1 16\n"
            "2 E1233650地球与空间科学学院磁层物理学专业必修3 9\n"
        )
        self.assertEqual(entries[0]["course_id"], "04031861")
        self.assertEqual(entries[0]["course_name"], "新时代劳动理论")
        self.assertEqual(entries[0]["course_system"], "全校公选课")
        self.assertEqual(entries[0]["credits"], 1.0)
        self.assertEqual(entries[0]["labor_hours"], 16.0)
        self.assertEqual(entries[1]["course_id"], "E1233650")
        self.assertTrue(any("non-numeric course_id" in warning for warning in warnings))

    def test_dynamic_labor_node_for_2021_program(self):
        program, _category = self.create_program(with_labor_node=False)
        user = User(username="labor-dynamic", role="student")
        db.session.add(user)
        db.session.flush()
        self.add_course(user, 1, "04031861")
        db.session.add(LaborEducationCoursePool(
            course_id="04031861",
            course_name="新时代劳动理论",
            course_system="全校公选课",
            credits=1,
            labor_hours=16,
        ))
        db.session.commit()

        result = ProgramProgressCalculator(user.id).calculate(program.id, 0)
        labor = next(node for node in result["categories"][0]["nodes"] if node["is_labor_education"])
        self.assertFalse(labor["qualified"])
        self.assertEqual(labor["labor_education_requirement"]["hours"], 16.0)
        self.assertEqual(labor["labor_education_requirement"]["required_hours"], 32.0)
        self.assertEqual(labor["credits"], 0)

    def test_labor_course_can_count_against_normal_list(self):
        program, category = self.create_program(with_labor_node=True)
        ordinary_node = Node(main_category_id=category.id, name="专业必修", order_index=1)
        db.session.add(ordinary_node)
        db.session.flush()
        ordinary_list = CourseList(node_id=ordinary_node.id, name="专业必修课程", filters={})
        db.session.add(ordinary_list)
        user = User(username="labor-dual", role="student")
        db.session.add(user)
        db.session.flush()
        source_uuid = self.add_course(user, 2, "04031861", credits=2)
        db.session.add(LaborEducationCoursePool(
            course_id="04031861",
            course_name="新时代劳动理论",
            course_system="专业必修",
            credits=2,
            labor_hours=32,
        ))
        db.session.add(CourseListAssignment(
            user_id=user.id,
            course_list_id=ordinary_list.id,
            source_type="course",
            source_uuid=source_uuid,
        ))
        db.session.commit()

        result = ProgramProgressCalculator(user.id).calculate(program.id, 0)
        labor = next(node for node in result["categories"][0]["nodes"] if node["is_labor_education"])
        ordinary = next(node for node in result["categories"][0]["nodes"] if node["name"] == "专业必修")
        self.assertTrue(labor["qualified"])
        self.assertEqual(labor["children"][0]["hours"], 32.0)
        self.assertEqual(ordinary["credits"], 2.0)
        self.assertEqual(result["total_credits"], 2.0)

    def test_pre_2021_program_does_not_add_labor_requirement(self):
        program, _category = self.create_program(with_labor_node=False, year=2020)
        user = User(username="labor-old", role="student")
        db.session.add(user)
        db.session.commit()
        result = ProgramProgressCalculator(user.id).calculate(program.id, 0)
        self.assertFalse(any(node.get("is_labor_education") for node in result["categories"][0]["nodes"]))


class LaborEducationSeedTest(unittest.TestCase):
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

    def test_seed_contains_source_directory(self):
        count = seed_default_pool()
        self.assertEqual(count, 78)
        self.assertIsNotNone(LaborEducationCoursePool.query.filter_by(course_id="04031861").first())
        self.assertIsNotNone(LaborEducationCoursePool.query.filter_by(course_id="E1233650").first())


if __name__ == "__main__":
    unittest.main()

