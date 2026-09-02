import json
import sys
import tempfile
import unittest
from pathlib import Path

from flask import Flask

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import db  # noqa: E402
from importer import get_import_policy, import_courses_from_json  # noqa: E402
from models import (  # noqa: E402
    Course,
    CourseNameMapping,
    SelectedCourse,
    Semester,
    User,
)


class CourseImporterTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        self.app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
        db.init_app(self.app)
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        self.temp_files = []

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.ctx.pop()
        for path in self.temp_files:
            path.unlink(missing_ok=True)

    def course(self, course_id, class_number, *, uuid=None, name="测试课程", credits=2):
        course = {
            "course_id": course_id,
            "course_name": name,
            "course_type": "专业任选",
            "department_code": "00001",
            "class_number": str(class_number),
            "credits": credits,
            "week_range": "1-16",
            "class_times": [{"day": 1, "start_period": 1, "end_period": 2}],
            "teachers": ["教师"],
            "remarks": "",
        }
        if uuid is not None:
            course["uuid"] = uuid
        return course

    def write_catalog(self, semester, courses):
        handle = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".json",
            delete=False,
        )
        with handle:
            json.dump({
                "metadata": {
                    "yearandseme": semester,
                    "format_version": "1.0",
                },
                "courses": courses,
            }, handle, ensure_ascii=False)
        path = Path(handle.name)
        self.temp_files.append(path)
        return path

    def import_catalog(self, path, **options):
        success, result = import_courses_from_json(path, **options)
        self.assertTrue(success, result)
        return result

    def test_missing_uuid_is_generated_and_course_master_is_shared(self):
        path = self.write_catalog("26-27-1", [
            self.course("00100514", 1),
            self.course("00100514", 2),
        ])

        result = self.import_catalog(
            path,
            first_week_monday="2026-09-07",
            import_mode="overwrite",
        )
        courses = Course.query.order_by(Course.class_number).all()

        self.assertTrue(result["semester_created"])
        self.assertEqual(result["requested_import_mode"], "overwrite")
        self.assertEqual(result["effective_import_mode"], "append")
        self.assertEqual(result["target_semester"], "26-27-1")
        self.assertEqual(len(courses), 2)
        self.assertTrue(all(course.uuid.startswith("BZ2627100100514") for course in courses))
        self.assertEqual(len({course.uuid for course in courses}), 2)
        self.assertEqual(CourseNameMapping.query.count(), 1)

    def test_import_policy_reports_identity_and_master_data_rules(self):
        policy = get_import_policy()

        self.assertEqual(
            policy["match_key"],
            ["target_semester", "course_id", "class_number"],
        )
        self.assertEqual(policy["course_master_key"], "course_id")
        self.assertEqual(policy["course_master_policy"], "upsert_only_never_delete")
        self.assertEqual(policy["new_semester_mode"], "append")

    def test_source_semester_uses_supplied_uuid(self):
        supplied_uuid = "BZ2627100100514_15551"
        path = self.write_catalog("26-27-1", [
            self.course("00100514", 1, uuid=supplied_uuid),
        ])

        self.import_catalog(path, first_week_monday="2026-09-07")

        self.assertIsNotNone(db.session.get(Course, supplied_uuid))

    def test_target_academic_year_keeps_term_and_regenerates_uuid(self):
        supplied_uuid = "BZ2627100100514_15551"
        path = self.write_catalog("26-27-1", [
            self.course("00100514", 1, uuid=supplied_uuid),
        ])

        result = self.import_catalog(
            path,
            target_academic_year="27-28",
            first_week_monday="2027-09-06",
        )
        imported = Course.query.one()

        self.assertEqual(result["target_semester"], "27-28-1")
        self.assertEqual(imported.semester, "27-28-1")
        self.assertNotEqual(imported.uuid, supplied_uuid)
        self.assertTrue(imported.uuid.startswith("BZ2728100100514_1"))

    def test_target_academic_year_preserves_long_cycle_uuid_scheme(self):
        path = self.write_catalog("26-27-2", [
            self.course(
                "30330033",
                1,
                uuid="CZ262730330033000001",
                name="教师指导下的独立研究",
                credits=4,
            ),
        ])

        result = self.import_catalog(
            path,
            target_academic_year="27-28",
            first_week_monday="2028-02-21",
        )
        imported = Course.query.one()

        self.assertEqual(result["target_semester"], "27-28-2")
        self.assertEqual(imported.uuid, "CZ272830330033000001")

    def test_append_updates_exact_identity_without_deleting_other_classes(self):
        initial = self.write_catalog("26-27-1", [
            self.course("00100514", 1, uuid="source-1", name="旧名称"),
            self.course("00100514", 2, uuid="source-2", name="旧名称"),
        ])
        self.import_catalog(initial, first_week_monday="2026-09-07")
        update = self.write_catalog("26-27-1", [
            self.course("00100514", 1, uuid="source-1", name="新名称", credits=3),
        ])

        result = self.import_catalog(update, import_mode="append")

        self.assertEqual(result["updated_count"], 1)
        self.assertEqual(Course.query.count(), 2)
        mapping = db.session.get(CourseNameMapping, "00100514")
        self.assertEqual(mapping.course_name, "新名称")
        self.assertEqual(mapping.credits, 3)

    def test_overwrite_cascades_class_links_but_retains_course_master_data(self):
        initial = self.write_catalog("26-27-1", [
            self.course("00100514", 1, uuid="old-1", name="旧名称"),
            self.course("00999999", 1, uuid="old-2", name="将被删除"),
        ])
        self.import_catalog(initial, first_week_monday="2026-09-07")
        user = User(username="local-test", role="local")
        db.session.add(user)
        db.session.flush()
        db.session.add_all([
            SelectedCourse(user_id=user.id, semester="26-27-1", course_uuid="old-1"),
            SelectedCourse(user_id=user.id, semester="26-27-1", course_uuid="old-2"),
        ])
        db.session.commit()

        replacement = self.write_catalog("26-27-1", [
            self.course("00100514", 1, uuid="new-1", name="新名称", credits=4),
        ])
        result = self.import_catalog(replacement, import_mode="overwrite")

        self.assertEqual(result["uuid_changed_count"], 1)
        self.assertEqual(result["removed_count"], 1)
        self.assertEqual([course.uuid for course in Course.query.all()], ["new-1"])
        self.assertEqual(SelectedCourse.query.count(), 0)
        self.assertIsNotNone(db.session.get(CourseNameMapping, "00100514"))
        self.assertIsNotNone(db.session.get(CourseNameMapping, "00999999"))

    def test_deleting_semester_cascades_classes_and_keeps_course_master(self):
        path = self.write_catalog("26-27-1", [
            self.course("00100514", 1, uuid="source-1"),
        ])
        self.import_catalog(path, first_week_monday="2026-09-07")
        user = User(username="local-test", role="local")
        db.session.add(user)
        db.session.flush()
        db.session.add(SelectedCourse(
            user_id=user.id,
            semester="26-27-1",
            course_uuid="source-1",
        ))
        db.session.commit()

        db.session.delete(Semester.query.filter_by(name="26-27-1").one())
        db.session.commit()

        self.assertEqual(Course.query.count(), 0)
        self.assertEqual(SelectedCourse.query.count(), 0)
        self.assertIsNotNone(db.session.get(CourseNameMapping, "00100514"))

    def test_new_semester_requires_valid_monday(self):
        path = self.write_catalog("26-27-1", [self.course("00100514", 1)])

        success, result = import_courses_from_json(path)
        self.assertFalse(success)
        self.assertIn("第一周周一", result["message"])

        success, result = import_courses_from_json(
            path,
            first_week_monday="2026-09-08",
        )
        self.assertFalse(success)
        self.assertIn("星期一", result["message"])


if __name__ == "__main__":
    unittest.main()
