import sys
import unittest
from pathlib import Path

from flask import Flask

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import db  # noqa: E402
from models import (  # noqa: E402
    Course,
    CourseList,
    CourseListAssignment,
    CourseNameMapping,
    MainCategory,
    Node,
    Program,
    Transcript,
    User,
)
from program_calculator import CourseMoveManager, ProgramProgressCalculator  # noqa: E402


class PhysicalEducationProgressTest(unittest.TestCase):
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

    def add_course(self, user, index, course_type, credits, catalog_uuid=None):
        course_id = f"PE{index:06d}"
        source_uuid = f"course-{index}"
        db.session.add(CourseNameMapping(
            course_id=course_id,
            course_name=f"课程 {index}",
            credits=credits,
        ))
        db.session.add(Course(
            uuid=catalog_uuid or source_uuid,
            course_id=course_id,
            course_type=course_type,
            department_code="00041",
            class_number=str(index),
            semester="26-27-1",
            class_times=[],
            teachers=[],
        ))
        db.session.add(Transcript(
            record_id=f"record-{index}",
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

    def create_program(self):
        program = Program(name="体育测试方案", dept="测试", channel=0, year=2026)
        db.session.add(program)
        db.session.flush()
        category = MainCategory(program_id=program.id, name="公共基础课程", order_index=0)
        db.session.add(category)
        db.session.flush()
        db.session.add(Node(
            main_category_id=category.id,
            name="体育课",
            order_index=0,
            requirement_type="credits",
            requirement_min=4.0,
            requirement_max=4.0,
            qualification_rules=[{"min_credits": 4.0}],
        ))
        db.session.flush()
        return program, category

    def test_only_exact_physical_education_type_counts(self):
        program, category = self.create_program()
        user = User(username="physical-test", role="student")
        db.session.add(user)
        db.session.flush()
        self.add_course(user, 1, "体育", 2.0, catalog_uuid="catalog-1")
        self.add_course(user, 2, "体育", 2.0)
        self.add_course(user, 3, "体育教研部", 2.0)
        self.add_course(user, 4, "全校必修", 2.0)
        db.session.commit()

        progress = ProgramProgressCalculator(user.id).calculate(
            program.id, channel=0, auto_distribute=True
        )
        sports = progress["categories"][0]["nodes"][0]

        self.assertTrue(sports["qualified"])
        self.assertEqual(sports["credits"], 4.0)
        self.assertEqual(sports["course_count"], 2)
        self.assertEqual(
            [course["course_type"] for course in sports["children"][0]["courses"]],
            ["体育", "体育"],
        )
        physical_list = CourseList.query.get(sports["children"][0]["id"])
        self.assertEqual(physical_list.filters, {"course_type": ["体育"]})
        assignments = CourseListAssignment.query.filter_by(
            user_id=user.id,
            course_list_id=physical_list.id,
            source_type="course",
        ).all()
        self.assertEqual({item.source_uuid for item in assignments}, {"course-1", "course-2"})

    def test_historical_transcript_uses_course_number_to_resolve_type(self):
        program, _category = self.create_program()
        user = User(username="physical-history", role="student")
        db.session.add(user)
        db.session.flush()
        self.add_course(user, 6, "体育", 4.0, catalog_uuid="current-course-6")
        db.session.commit()

        progress = ProgramProgressCalculator(user.id).calculate(
            program.id, channel=0, auto_distribute=False
        )
        sports = progress["categories"][0]["nodes"][0]

        self.assertTrue(sports["qualified"])
        self.assertEqual(sports["credits"], 4.0)
        self.assertEqual(sports["children"][0]["courses"][0]["course_type"], "体育")

    def test_physical_course_can_be_moved_out_and_back(self):
        program, category = self.create_program()
        other_node = Node(
            main_category_id=category.id,
            name="其他课程",
            order_index=1,
        )
        db.session.add(other_node)
        db.session.flush()
        other_list = CourseList(
            node_id=other_node.id,
            name="其他课程列表",
            filters={},
            qualification_rules=[],
        )
        db.session.add(other_list)
        user = User(username="physical-move", role="student")
        db.session.add(user)
        db.session.flush()
        self.add_course(user, 7, "体育", 2.0)
        db.session.commit()

        calculator = ProgramProgressCalculator(user.id)
        progress = calculator.calculate(program.id, channel=0, auto_distribute=True)
        sports = progress["categories"][0]["nodes"][0]
        physical_list_id = sports["children"][0]["id"]
        manager = CourseMoveManager(user.id, channel=0, program_id=program.id)

        success, _message = manager.move("course-7", other_list.id)
        self.assertTrue(success)
        moved_out = calculator.calculate(program.id, channel=0, auto_distribute=False)
        self.assertEqual(moved_out["categories"][0]["nodes"][0]["credits"], 0.0)
        self.assertEqual(
            moved_out["categories"][0]["nodes"][1]["children"][0]["course_count"],
            1,
        )

        success, _message = manager.move("course-7", physical_list_id)
        self.assertTrue(success)
        moved_back = calculator.calculate(program.id, channel=0, auto_distribute=False)
        self.assertEqual(moved_back["categories"][0]["nodes"][0]["credits"], 2.0)

    def test_physical_education_requirement_comes_from_plan(self):
        program, category = self.create_program()
        category.nodes[0].requirement_min = 6.0
        category.nodes[0].requirement_max = 6.0
        user = User(username="physical-incomplete", role="student")
        db.session.add(user)
        db.session.flush()
        self.add_course(user, 5, "体育", 2.0)
        db.session.commit()

        progress = ProgramProgressCalculator(user.id).calculate(
            program.id, channel=0, auto_distribute=False
        )
        sports = progress["categories"][0]["nodes"][0]

        self.assertFalse(sports["qualified"])
        self.assertEqual(sports["physical_education_requirement"]["required_credits"], 6.0)
        self.assertEqual(sports["credits"], 2.0)


if __name__ == "__main__":
    unittest.main()
