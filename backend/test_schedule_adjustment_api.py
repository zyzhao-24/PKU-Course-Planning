import unittest
from datetime import date

from flask import Flask

from auth_utils import generate_jwt_token
from models import (
    ScheduleAdjustment,
    ScheduleAdjustmentEntry,
    Semester,
    User,
    db,
)
from schedule_adjustment_api import schedule_adjustment_bp


class ScheduleAdjustmentApiTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        self.app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
        db.init_app(self.app)
        self.app.register_blueprint(schedule_adjustment_bp)
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()

        self.admin = User(username='adjustment-admin', role='admin')
        self.student = User(username='adjustment-student', role='local')
        db.session.add_all([
            self.admin,
            self.student,
            Semester(
                academic_year='26-27',
                term=1,
                name='26-27-1',
                first_week_monday=date(2026, 9, 7),
            ),
        ])
        db.session.commit()
        self.client = self.app.test_client()
        self.admin_headers = {'Authorization': f'Bearer {generate_jwt_token(self.admin)}'}
        self.student_headers = {'Authorization': f'Bearer {generate_jwt_token(self.student)}'}

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def payload(self):
        return {
            'semester': '26-27-1',
            'name': '国庆节教学安排',
            'reason': '校历调整',
            'entries': [
                {'actual': {'week': 4, 'day': 5}, 'mode': 'off'},
                {
                    'actual': {'week': 4, 'day': 7},
                    'mode': 'mapped',
                    'use_schedule_of': {'week': 4, 'day': 5},
                },
            ],
        }

    def test_group_crud_and_student_read(self):
        created = self.client.post(
            '/api/admin/semester-adjustments',
            json=self.payload(),
            headers=self.admin_headers,
        )
        self.assertEqual(created.status_code, 201)
        item = created.get_json()['adjustment']
        self.assertEqual(len(item['entries']), 2)

        listed = self.client.get(
            '/api/semester-adjustments?semester=26-27-1',
            headers=self.student_headers,
        )
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.get_json()['adjustments']), 1)

        updated_payload = self.payload()
        updated_payload['entries'].append({
            'actual': {'week': 4, 'day': 6},
            'mode': 'mapped',
            'use_schedule_of': {'week': 4, 'day': 5},
        })
        updated = self.client.put(
            f"/api/admin/semester-adjustments/{item['id']}",
            json=updated_payload,
            headers=self.admin_headers,
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(len(updated.get_json()['adjustment']['entries']), 3)

        deleted = self.client.delete(
            f"/api/admin/semester-adjustments/{item['id']}",
            headers=self.admin_headers,
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(ScheduleAdjustment.query.count(), 0)
        self.assertEqual(ScheduleAdjustmentEntry.query.count(), 0)

    def test_actual_is_unique_but_source_can_repeat(self):
        first = self.client.post(
            '/api/admin/semester-adjustments',
            json=self.payload(),
            headers=self.admin_headers,
        )
        self.assertEqual(first.status_code, 201)

        repeated_source = {
            'semester': '26-27-1',
            'name': '补课安排',
            'entries': [{
                'actual': {'week': 5, 'day': 1},
                'mode': 'mapped',
                'use_schedule_of': {'week': 4, 'day': 5},
            }],
        }
        accepted = self.client.post(
            '/api/admin/semester-adjustments',
            json=repeated_source,
            headers=self.admin_headers,
        )
        self.assertEqual(accepted.status_code, 201)

        duplicate_actual = {
            **repeated_source,
            'name': '重复实际日',
            'entries': [{
                'actual': {'week': 4, 'day': 5},
                'mode': 'mapped',
                'use_schedule_of': {'week': 6, 'day': 1},
            }],
        }
        rejected = self.client.post(
            '/api/admin/semester-adjustments',
            json=duplicate_actual,
            headers=self.admin_headers,
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertIn('已在其他调整方案中设置', rejected.get_json()['message'])

    def test_invalid_slots_and_noop_mapping_are_rejected(self):
        payload = self.payload()
        payload['entries'] = [{
            'actual': {'week': 19, 'day': 1},
            'mode': 'off',
        }]
        out_of_range = self.client.post(
            '/api/admin/semester-adjustments',
            json=payload,
            headers=self.admin_headers,
        )
        self.assertEqual(out_of_range.status_code, 400)
        self.assertIn('0-18', out_of_range.get_json()['message'])

        payload['entries'] = [{
            'actual': {'week': 3, 'day': 2},
            'mode': 'mapped',
            'use_schedule_of': {'week': 3, 'day': 2},
        }]
        noop = self.client.post(
            '/api/admin/semester-adjustments',
            json=payload,
            headers=self.admin_headers,
        )
        self.assertEqual(noop.status_code, 400)
        self.assertIn('不能与', noop.get_json()['message'])

    def test_semester_delete_cascades_adjustment_groups(self):
        response = self.client.post(
            '/api/admin/semester-adjustments',
            json=self.payload(),
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 201)
        db.session.delete(Semester.query.filter_by(name='26-27-1').one())
        db.session.commit()

        self.assertEqual(ScheduleAdjustment.query.count(), 0)
        self.assertEqual(ScheduleAdjustmentEntry.query.count(), 0)


if __name__ == '__main__':
    unittest.main()
