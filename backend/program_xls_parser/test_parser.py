import importlib.util
import json
import unittest
from pathlib import Path

from .parser import parse_xls


REPO_ROOT = Path(__file__).resolve().parents[2]
DEMO_FILES = [
    REPO_ROOT / "demo_data" / "xk_cs.xls",
    REPO_ROOT / "demo_data" / "jap.xls",
    REPO_ROOT / "demo_data" / "yp_cs.xls",
]


@unittest.skipUnless(importlib.util.find_spec("xlrd"), "xlrd is required for .xls parser tests")
class ProgramXlsParserTest(unittest.TestCase):
    def test_demo_files_parse_to_structured_json(self):
        for demo_file in DEMO_FILES:
            with self.subTest(demo_file=demo_file.name):
                data = parse_xls(str(demo_file))

                self.assertIn("metadata", data)
                self.assertIn("categories", data)
                self.assertIn("warnings", data)
                self.assertTrue(data["metadata"]["plan_name"]["value"])
                self.assertNotIn("raw", data["metadata"]["plan_name"])
                self.assertIn("raw", data["metadata"]["total_credits"])
                self.assertIn("value", data["metadata"]["total_credits"])
                self.assertGreater(len(data["categories"]), 0)

                category_names = [category["name"] for category in data["categories"]]
                self.assertIn("公共基础课程", category_names)

                first_requirement = data["categories"][0]["requirement"]
                self.assertIn("raw", first_requirement)
                self.assertIn("type", first_requirement)
                self.assertIn("min", first_requirement)
                self.assertIn("max", first_requirement)

                courses = [
                    course
                    for category in data["categories"]
                    for module in category["modules"]
                    for group in module["groups"]
                    for course in group["courses"]
                ]
                self.assertGreater(len(courses), 0)
                self.assertTrue(any(course["course_id"] for course in courses))

                json.loads(json.dumps(data, ensure_ascii=False))

    def test_xk_contains_remark_rules_and_mutual_exclusion_raw(self):
        data = parse_xls(str(REPO_ROOT / "demo_data" / "xk_cs.xls"))

        remarks = [
            item["remark"]
            for category in data["categories"]
            for item in [category, *category["modules"]]
            if item.get("remark")
        ]
        self.assertTrue(any("raw" in remark and "value" in remark for remark in remarks))

        rules = [
            rule
            for category in data["categories"]
            for module in category["modules"]
            for rule in module["rules"]
        ]
        self.assertTrue(any("raw" in rule for rule in rules))

        exclusions = [
            exclusion
            for category in data["categories"]
            for module in category["modules"]
            for exclusion in module["mutual_exclusion"]
        ]
        self.assertTrue(any(exclusion["raw"] and len(exclusion["course_ids"]) >= 2 for exclusion in exclusions))

    def test_requirement_type_parsing_covers_credits_courses_and_hours(self):
        data = parse_xls(str(REPO_ROOT / "demo_data" / "xk_cs.xls"))
        requirements = []
        for category in data["categories"]:
            requirements.append(category["requirement"])
            for module in category["modules"]:
                requirements.append(module["requirement"])
                for group in module["groups"]:
                    requirements.append(group["requirement"])

        requirement_types = {req["type"] for req in requirements}
        self.assertIn("credits", requirement_types)
        self.assertIn("courses", requirement_types)
        self.assertIn("hours", requirement_types)


if __name__ == "__main__":
    unittest.main()
