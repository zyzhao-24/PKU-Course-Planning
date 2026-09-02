import unittest
from datetime import date

from flask import Flask

from activity_api import activity_bp
from auth_utils import generate_jwt_token
from models import ScheduleActivity, Semester, User, db


class ActivityApiTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        self.app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
        db.init_app(self.app)
        self.app.register_blueprint(activity_bp)
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()

        self.user = User(username='activity-user', role='local')
        self.other_user = User(username='other-user', role='local')
        db.session.add_all([
            self.user,
            self.other_user,
            Semester(
                academic_year='26-27',
                term=1,
                name='26-27-1',
                first_week_monday=date(2026, 9, 7),
            ),
        ])
        db.session.commit()
        self.client = self.app.test_client()
        self.headers = {'Authorization': f'Bearer {generate_jwt_token(self.user)}'}
        self.other_headers = {'Authorization': f'Bearer {generate_jwt_token(self.other_user)}'}

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def payload(self):
        return {
            'semester': '26-27-1',
            'title': '课题组组会',
            'color': 'green',
            'notes': '汇报进度',
            'time_entries': [{
                'recurrence': {
                    'type': 'weeks',
                    'day': 3,
                    'week_range': '1-16',
                    'week_type': 0,
                },
                'time': {'type': 'clock', 'start': '12:30', 'end': '13:30'},
                'location': '理科一号楼',
                'blocking': True,
            }],
        }

    def test_activity_crud_and_ownership(self):
        response = self.client.post('/api/student/activities', json=self.payload(), headers=self.headers)
        self.assertEqual(response.status_code, 201)
        activity = response.get_json()['activity']
        self.assertTrue(activity['uuid'].startswith('activity-'))

        listed = self.client.get('/api/student/activities?semester=26-27-1', headers=self.headers)
        self.assertEqual(len(listed.get_json()['activities']), 1)

        updated_payload = self.payload()
        updated_payload['title'] = '新组会'
        updated_payload['time_entries'] = [{
            'recurrence': {'type': 'weeks', 'day': 2, 'week_range': '0', 'week_type': 0},
            'time': {'type': 'periods', 'start_period': 5, 'end_period': 6},
            'location': '会议室',
            'blocking': False,
        }]
        updated = self.client.put(
            f"/api/student/activities/{activity['uuid']}",
            json=updated_payload,
            headers=self.headers,
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()['activity']['title'], '新组会')
        self.assertFalse(updated.get_json()['activity']['time_entries'][0]['blocking'])

        forbidden = self.client.delete(
            f"/api/student/activities/{activity['uuid']}",
            headers=self.other_headers,
        )
        self.assertEqual(forbidden.status_code, 404)

        deleted = self.client.delete(
            f"/api/student/activities/{activity['uuid']}",
            headers=self.headers,
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(ScheduleActivity.query.count(), 0)

    def test_invalid_activity_time_is_rejected(self):
        payload = self.payload()
        payload['time_entries'][0]['recurrence']['week_range'] = '1-20'
        response = self.client.post('/api/student/activities', json=payload, headers=self.headers)

        self.assertEqual(response.status_code, 400)
        self.assertIn('0-18', response.get_json()['message'])

    def test_week_zero_is_accepted(self):
        payload = self.payload()
        payload['time_entries'][0]['recurrence']['week_range'] = '0'
        response = self.client.post('/api/student/activities', json=payload, headers=self.headers)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.get_json()['activity']['time_entries'][0]['recurrence']['week_range'],
            '0',
        )

    def test_date_recurrence_is_not_accepted_for_storage(self):
        payload = self.payload()
        payload['time_entries'][0]['recurrence'] = {'type': 'date', 'date': '2026-09-07'}
        response = self.client.post('/api/student/activities', json=payload, headers=self.headers)

        self.assertEqual(response.status_code, 400)
        self.assertIn('只能是 weeks', response.get_json()['message'])

    def test_semester_delete_cascades_activities(self):
        response = self.client.post('/api/student/activities', json=self.payload(), headers=self.headers)
        self.assertEqual(response.status_code, 201)
        semester = Semester.query.filter_by(name='26-27-1').one()
        db.session.delete(semester)
        db.session.commit()

        self.assertEqual(ScheduleActivity.query.count(), 0)


if __name__ == '__main__':
    unittest.main()
