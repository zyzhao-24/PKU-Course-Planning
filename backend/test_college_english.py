import sys
import unittest
from pathlib import Path

from flask import Flask

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import db
from models import (  # noqa: E402
    CollegeEnglishCoursePool,
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
from college_english import (  # noqa: E402
    ENGLISH_LEVEL_VALUES,
    ENGLISH_MODULE_VALUES,
    get_english_options,
    load_default_pool_entries,
)


class CollegeEnglishProgressTest(unittest.TestCase):
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

    def reset_db(self):
        db.session.remove()
        db.drop_all()
        db.create_all()

    def create_program(self):
        program = Program(name="Test Program", dept="Test", channel=0, year=2026)
        db.session.add(program)
        db.session.flush()

        category = MainCategory(program_id=program.id, name="公共基础课程", order_index=0)
        db.session.add(category)
        db.session.flush()

        english_node = Node(main_category_id=category.id, name="大学英语", order_index=0)
        db.session.add(english_node)
        db.session.flush()

        other_node = Node(main_category_id=category.id, name="其他公共基础", order_index=1)
        db.session.add(other_node)
        db.session.flush()
        catch_all = CourseList(
            node_id=other_node.id,
            name="普通全校必修",
            filters={"course_type": ["大学英语"]},
            qualification_rules=[],
        )
        db.session.add(catch_all)
        db.session.flush()
        return program, english_node, catch_all

    def add_user(self, level):
        user = User(username=f"user-{level or 'none'}", role="student", english_level=level)
        db.session.add(user)
        db.session.flush()
        return user

    def add_english_course(self, user, module, index, credits=2.0):
        course_id = f"{module[:3]}{index:04d}".replace("_", "")
        course_name = f"{module} course {index}"
        source_uuid = f"{module}-{index}"

        db.session.add(CollegeEnglishCoursePool(
            course_id=course_id,
            course_name=course_name,
            module=module,
            active=True,
            order_index=index,
        ))
        db.session.add(CourseNameMapping(
            course_id=course_id,
            course_name=course_name,
            credits=credits,
        ))
        db.session.add(Course(
            uuid=source_uuid,
            course_id=course_id,
            course_type="大学英语",
            department_code="038",
            class_number=str(index),
            semester="26-27-1",
            class_times=[],
            teachers=[],
        ))
        db.session.add(Transcript(
            record_id=f"record-{source_uuid}",
            user_id=user.id,
            uuid=source_uuid,
            course_id=course_id,
            class_number=str(index),
            academic_year="26-27",
            term=1,
            course_name=course_name,
            score="90",
            score_type="Percentage",
            credits=credits,
            channel=0,
        ))
        return source_uuid

    def add_regular_course(self, user, course_id="99990001", course_name="Unmatched Course", credits=2.0):
        source_uuid = f"regular-{course_id}"
        db.session.add(CourseNameMapping(
            course_id=course_id,
            course_name=course_name,
            credits=credits,
        ))
        db.session.add(Course(
            uuid=source_uuid,
            course_id=course_id,
            course_type="不匹配类型",
            department_code="999",
            class_number="1",
            semester="26-27-1",
            class_times=[],
            teachers=[],
        ))
        db.session.add(Transcript(
            record_id=f"record-{source_uuid}",
            user_id=user.id,
            uuid=source_uuid,
            course_id=course_id,
            class_number="1",
            academic_year="26-27",
            term=1,
            course_name=course_name,
            score="90",
            score_type="Percentage",
            credits=credits,
            channel=0,
        ))
        return source_uuid

    def build_case(self, level, module_counts):
        program, english_node, catch_all = self.create_program()
        user = self.add_user(level)
        source_uuids = []
        for module, count in module_counts.items():
            for index in range(count):
                source_uuids.append(self.add_english_course(user, module, index + 1))
        db.session.commit()
        return user, program, english_node, catch_all, source_uuids

    def calculate_case(self, level, module_counts):
        user, program, _node, catch_all, source_uuids = self.build_case(level, module_counts)
        progress = ProgramProgressCalculator(user.id).calculate(program.id, channel=0, auto_distribute=True)
        english = progress["categories"][0]["nodes"][0]
        return progress, english, catch_all, source_uuids

    def test_all_college_english_levels_can_qualify(self):
        cases = [
            ("Y", {"Y": 4}, 8.0),
            ("A", {"A": 2, "B": 2}, 8.0),
            ("B", {"B": 2, "C": 1}, 6.0),
            ("C", {"C": 2}, 4.0),
            ("C_PLUS", {"C_PLUS": 1}, 2.0),
        ]

        for level, modules, expected_credits in cases:
            with self.subTest(level=level):
                self.reset_db()
                _progress, english, _catch_all, _source_uuids = self.calculate_case(level, modules)
                self.assertTrue(english["qualified"])
                self.assertEqual(english["credits"], expected_credits)

    def test_c_plus_is_user_level_and_course_module(self):
        self.assertIn("C_PLUS", ENGLISH_LEVEL_VALUES)
        self.assertIn("C_PLUS", ENGLISH_MODULE_VALUES)

    def test_runtime_metadata_is_loaded_from_clean_resource(self):
        options = get_english_options("C_PLUS")
        c_plus = next(
            level for level in options["levels"]
            if level["value"] == "C_PLUS"
        )
        entries = load_default_pool_entries()

        self.assertEqual(c_plus["required_credits"], 2)
        self.assertEqual(options["requirements"]["C_PLUS"], [{"C_PLUS": 2}])
        self.assertTrue(any(
            entry["course_id"] == "03835780"
            and entry["module"] == "C_PLUS"
            for entry in entries
        ))
        self.assertTrue(all(
            set(entry) == {"course_id", "course_name", "module"}
            for entry in entries
        ))

    def test_c_level_accepts_c_plus_path(self):
        _progress, english, _catch_all, _source_uuids = self.calculate_case("C", {"C": 1, "C_PLUS": 1})

        self.assertTrue(english["qualified"])
        self.assertEqual(english["credits"], 4.0)
        self.assertEqual(set(english["english_requirement"]["module_status"]), {"C", "C_PLUS"})
        self.assertEqual(len(english["children"]), 2)
        self.assertTrue(all(child["is_college_english_virtual"] for child in english["children"]))
        self.assertTrue(all(child["courses"] for child in english["children"]))
        self.assertTrue(all(isinstance(child["id"], int) for child in english["children"]))
        self.assertTrue(all(CourseList.query.get(child["id"]) for child in english["children"]))

    def test_unqualified_college_english_courses_are_not_consumed(self):
        user, program, _english_node, _catch_all, source_uuids = self.build_case("C", {"C_PLUS": 1})

        progress = ProgramProgressCalculator(user.id).calculate(program.id, channel=0, auto_distribute=False)
        english = progress["categories"][0]["nodes"][0]
        unassigned_uuids = {course["source_uuid"] for course in progress["unassigned_courses"]}

        self.assertFalse(english["qualified"])
        self.assertEqual(english["credits"], 0.0)
        self.assertEqual(english["english_requirement"]["selected_source_uuids"], [])
        self.assertTrue(all(not child["courses"] for child in english["children"]))
        self.assertIn(source_uuids[0], unassigned_uuids)

    def test_c_plus_level_requires_c_plus_course(self):
        _progress, english, _catch_all, source_uuids = self.calculate_case("C_PLUS", {"C_PLUS": 1})

        self.assertTrue(english["qualified"])
        self.assertEqual(english["credits"], 2.0)
        self.assertEqual(english["course_count"], 1)
        self.assertEqual(len(english["children"]), 1)
        self.assertEqual(
            english["english_requirement"]["selected_source_uuids"],
            source_uuids,
        )

    def test_c_plus_level_without_course_is_not_qualified(self):
        _progress, english, _catch_all, _source_uuids = self.calculate_case("C_PLUS", {})

        self.assertFalse(english["qualified"])
        self.assertEqual(english["credits"], 0.0)
        self.assertEqual(english["course_count"], 0)

    def test_unset_level_is_not_qualified(self):
        _progress, english, _catch_all, _source_uuids = self.calculate_case(None, {"C": 2})

        self.assertFalse(english["qualified"])
        self.assertFalse(english["english_requirement"]["configured"])
        self.assertIn("选择大学英语分级", english["english_requirement"]["message"])

    def test_college_english_courses_are_persisted_in_english_module_lists(self):
        _progress, english, catch_all, source_uuids = self.calculate_case("C", {"C": 2})

        self.assertTrue(english["qualified"])
        self.assertEqual(
            CourseListAssignment.query.filter_by(course_list_id=catch_all.id).count(),
            0,
        )
        assignments = CourseListAssignment.query.filter(
            CourseListAssignment.source_uuid.in_(source_uuids),
            CourseListAssignment.source_type == "course",
        ).all()
        self.assertEqual(len(assignments), len(source_uuids))
        self.assertTrue(all(a.course_list.raw.startswith("college_english:") for a in assignments))

    def test_english_course_can_move_out_and_back_into_english_module(self):
        user, program, _english_node, catch_all, source_uuids = self.build_case("C", {"C": 1})
        calculator = ProgramProgressCalculator(user.id)
        progress = calculator.calculate(program.id, channel=0, auto_distribute=True)
        english = progress["categories"][0]["nodes"][0]
        english_list_id = english["children"][0]["id"]

        manager = CourseMoveManager(user.id, channel=0, program_id=program.id)
        success, _message = manager.move(source_uuids[0], catch_all.id)
        self.assertTrue(success)
        moved_out = calculator.calculate(program.id, channel=0, auto_distribute=False)
        self.assertEqual(
            [course["source_uuid"] for course in moved_out["categories"][0]["nodes"][1]["children"][0]["courses"]],
            [source_uuids[0]],
        )
        self.assertEqual(moved_out["categories"][0]["nodes"][0]["english_requirement"]["selected_source_uuids"], [])

        success, _message = manager.move(source_uuids[0], english_list_id)
        self.assertTrue(success)
        moved_back = calculator.calculate(program.id, channel=0, auto_distribute=False)
        self.assertEqual(
            moved_back["categories"][0]["nodes"][0]["english_requirement"]["selected_source_uuids"],
            [source_uuids[0]],
        )
        self.assertEqual(CourseListAssignment.query.filter_by(course_list_id=catch_all.id).count(), 0)

    def test_recalculate_clears_english_exclusion_and_reassigns_course(self):
        user, program, _english_node, _catch_all, source_uuids = self.build_case("C", {"C": 1})
        user.major_program_id = program.id
        db.session.commit()
        calculator = ProgramProgressCalculator(user.id)
        progress = calculator.calculate(program.id, channel=0, auto_distribute=True)
        english_list_id = progress["categories"][0]["nodes"][0]["children"][0]["id"]

        assignment = CourseListAssignment.query.filter_by(
            user_id=user.id,
            source_type="course",
            source_uuid=source_uuids[0],
        ).first()
        assignment.course_list_id = None
        db.session.add(CourseListAssignment(
            user_id=user.id,
            course_list_id=None,
            source_type="college_english_excluded",
            source_uuid=source_uuids[0],
        ))
        db.session.commit()

        calculator.recalculate()

        assignment = CourseListAssignment.query.filter_by(
            user_id=user.id,
            source_type="course",
            source_uuid=source_uuids[0],
        ).first()
        self.assertEqual(assignment.course_list_id, english_list_id)
        self.assertIsNone(CourseListAssignment.query.filter_by(
            user_id=user.id,
            source_type="college_english_excluded",
            source_uuid=source_uuids[0],
        ).first())

    def test_unassigned_courses_include_missing_assignment_records(self):
        program, _english_node, _catch_all = self.create_program()
        user = self.add_user("C")
        source_uuid = self.add_regular_course(user)
        db.session.commit()

        progress = ProgramProgressCalculator(user.id).calculate(program.id, channel=0, auto_distribute=False)

        self.assertEqual(
            [course["source_uuid"] for course in progress["unassigned_courses"]],
            [source_uuid],
        )

    def test_only_consumed_college_english_courses_are_hidden_from_unassigned(self):
        user, program, _english_node, _catch_all, source_uuids = self.build_case("C", {"C": 1, "C_PLUS": 2})

        progress = ProgramProgressCalculator(user.id).calculate(program.id, channel=0, auto_distribute=False)
        unassigned_uuids = {course["source_uuid"] for course in progress["unassigned_courses"]}

        self.assertNotIn(source_uuids[0], unassigned_uuids)
        self.assertNotIn(source_uuids[1], unassigned_uuids)
        self.assertIn(source_uuids[2], unassigned_uuids)

    def test_manually_assigned_english_course_is_not_consumed_by_english_node(self):
        user, program, _english_node, catch_all, source_uuids = self.build_case("C", {"C": 1, "C_PLUS": 1})
        db.session.add(CourseListAssignment(
            user_id=user.id,
            course_list_id=catch_all.id,
            source_type="course",
            source_uuid=source_uuids[1],
        ))
        db.session.commit()

        progress = ProgramProgressCalculator(user.id).calculate(program.id, channel=0, auto_distribute=False)
        english = progress["categories"][0]["nodes"][0]
        catch_all_result = progress["categories"][0]["nodes"][1]["children"][0]

        self.assertFalse(english["qualified"])
        self.assertEqual(english["english_requirement"]["selected_source_uuids"], [])
        self.assertEqual([course["source_uuid"] for course in catch_all_result["courses"]], [source_uuids[1]])


if __name__ == "__main__":
    unittest.main()
