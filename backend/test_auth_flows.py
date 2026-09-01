import unittest
from datetime import datetime

import auth_utils
from client import ClientBase, LoginMethod, LoginReqs, PKUIAAALoginClient


class FakeResponse:
    def __init__(self, payload):
        self.ok = True
        self._payload = payload

    def json(self):
        return self._payload


class AuthFlowTest(unittest.TestCase):
    def tearDown(self):
        auth_utils._login_sessions.clear()

    def test_default_clients_use_independent_http_sessions(self):
        first = ClientBase()
        second = ClientBase()
        self.addCleanup(first.session.close)
        self.addCleanup(second.session.close)

        self.assertIsNot(first.session, second.session)

    def test_mobile_auth_check_resets_previous_username_requirements(self):
        client = PKUIAAALoginClient.__new__(PKUIAAALoginClient)
        client.method = LoginMethod.PASSWORD
        client.base_url = 'https://iaaa.example'
        client.app_id = 'portal2017'
        client._init_reqs = LoginReqs.CAPTCHA
        client.auth_reqs = LoginReqs.OTP
        client.get = lambda *_args, **_kwargs: FakeResponse({
            'success': True,
            'isMobileAuthen': False,
        })

        client.chk_mobile_auth('student')

        self.assertEqual(client.auth_reqs, LoginReqs.CAPTCHA)

    def test_mobile_auth_check_combines_otp_and_binding_requirements(self):
        client = PKUIAAALoginClient.__new__(PKUIAAALoginClient)
        client.method = LoginMethod.PASSWORD
        client.base_url = 'https://iaaa.example'
        client.app_id = 'portal2017'
        client._init_reqs = LoginReqs.CAPTCHA
        client.auth_reqs = LoginReqs.NONE
        client.get = lambda *_args, **_kwargs: FakeResponse({
            'success': True,
            'isMobileAuthen': True,
            'authenMode': 'OTP',
            'isBind': False,
        })

        client.chk_mobile_auth('student')

        self.assertTrue(client.auth_reqs & LoginReqs.CAPTCHA)
        self.assertTrue(client.auth_reqs & LoginReqs.OTP)
        self.assertTrue(client.auth_reqs & LoginReqs.BIND_OTP)

    def test_sms_json_failure_is_not_reported_as_success(self):
        class FakeClient:
            def send_sms_code(self, _username):
                return {'success': False, 'message': '发送失败'}

        auth_utils._login_sessions['session'] = {
            'client': FakeClient(),
            'username': 'student',
            'created_at': datetime.now(),
            'mobile_mask': '',
            'last_sms_sent_at': None,
        }

        success, message = auth_utils.send_sms_code('session')

        self.assertFalse(success)
        self.assertEqual(message, '发送失败')

    def test_login_response_can_enable_captcha_after_failure(self):
        class FakeClient:
            auth_reqs = LoginReqs.NONE

            def password_login(self, **_kwargs):
                return {
                    'success': False,
                    'showCode': True,
                    'errors': {'code': 'E01', 'msg': '密码错误'},
                }

        client = FakeClient()
        auth_utils._login_sessions['session'] = {
            'client': client,
            'username': 'student',
            'created_at': datetime.now(),
            'mobile_mask': '',
            'last_sms_sent_at': None,
        }

        success, message, user = auth_utils.password_login('session', 'password')
        requirements_success, requirements = auth_utils.get_login_auth_requirements('session')

        self.assertFalse(success)
        self.assertEqual(message, '[E01] 密码错误')
        self.assertIsNone(user)
        self.assertTrue(requirements_success)
        self.assertTrue(requirements['requires_captcha'])

    def test_otp_binding_requirement_blocks_password_login(self):
        class FakeClient:
            auth_reqs = LoginReqs(LoginReqs.OTP.value | LoginReqs.BIND_OTP.value)

            def password_login(self, **_kwargs):
                raise AssertionError('IAAA login must not be called before OTP binding')

        auth_utils._login_sessions['session'] = {
            'client': FakeClient(),
            'username': 'student',
            'created_at': datetime.now(),
            'mobile_mask': '',
            'last_sms_sent_at': None,
        }

        success, message, user = auth_utils.password_login(
            'session',
            'password',
            otp_code='123456',
        )

        self.assertFalse(success)
        self.assertEqual(message, '请先绑定手机令牌')
        self.assertIsNone(user)

    def test_successful_sms_send_starts_session_cooldown(self):
        class FakeClient:
            def send_sms_code(self, _username):
                return {'success': True, 'mobileMask': '138****0000'}

        auth_utils._login_sessions['session'] = {
            'client': FakeClient(),
            'username': 'student',
            'created_at': datetime.now(),
            'mobile_mask': '',
            'last_sms_sent_at': None,
        }

        first_success, _ = auth_utils.send_sms_code('session')
        second_success, second_message = auth_utils.send_sms_code('session')

        self.assertTrue(first_success)
        self.assertFalse(second_success)
        self.assertIn('秒后重新发送', second_message)


if __name__ == '__main__':
    unittest.main()
