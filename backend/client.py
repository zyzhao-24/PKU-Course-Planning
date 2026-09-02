import os
import tempfile
import random
import base64
import re
from typing import Optional
from enum import Enum, IntFlag

import requests
import ssl
import certifi

# required package: pycryptodome
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_v1_5

class ClientBase:
    '''
    Base class for clients

    **Usage:**
    - ``get``: Wrapper for session.get, can be used directly for requests.
    - ``post``: Wrapper for session.post, can be used directly for requests.
    '''
    def __init__(self, session: Optional[requests.Session] = None):
        '''
        Initialize the client with a requests session.
        You can provide your own session with custom configuration (e.g., proxies, retries) if needed, 
        or just use the default session.

        :param session: The session to use for requests. Defaults to empty session with default configuration.
        :type session: requests.Session, optional
        '''
        session = session or requests.Session()

        # Initialize session header
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest'
        })

        # Set session and convenience methods for requests
        self.session = session
        self.get = session.get
        self.post = session.post
        self.headers = session.headers

class LoginMethod(Enum):
    '''
    Enum for login methods.
    - PASSWORD: Traditional username/password login
    - QR: QR code login
    '''
    PASSWORD = "password"
    QR = "qr"

class LoginReqs(IntFlag):
    '''
    Bitwise enum for authentication requirements.
    - NONE: No additional authentication required
    - QR: QR code login
    - CAPTCHA: CAPTCHA verification
    - SMS: Message authentication
    - OTP: OTP token authentication
    - BIND_OTP: Requires OTP token binding (only used in mobile authentication check response)

    For ``BIND_OTP``, the user needs to bind an OTP token manually if they have not done so,
    following the instructions at https://iaaa.pku.edu.cn/iaaa/resources/help/otpHelp.html.
    Failing to do so may lead to login failure.
    '''
    NONE = 0
    QR = 1
    CAPTCHA = 2
    SMS = 4
    OTP = 8
    BIND_OTP = 16

class PKUIAAAError(Exception):
    '''
    Exception for PKUIAAA login errors.
    '''
    def __init__(self, message: str, code: Optional[int] = None):
        '''
        Initializer for PKUIAAAError.

        :param message: Error message describing the issue
        :type message: str
        :param code: Error code for request if available. Defaults to None.
        :type code: int, optional
        '''
        super().__init__(message)
        self.code = code

class PKUIAAALoginClient(ClientBase):
    '''
    The login client for PKU IAAA

    Supported login methods:
    - PASSWORD: Traditional username/password login with optional CAPTCHA, SMS, and OTP verification.
    - QR: QR code login using the official "Peking University" app.

    **Usage:**
    - Password login:
    1. Initialize client with app_id, redirect_url, method=LoginMethod.PASSWORD and optional session,
       or call switch_method(LoginMethod.PASSWORD) from an initialized client.
    2. Check CAPTCHA requirements from ``auth_reqs`` and get CAPTCHA if needed.
    3. Update authentication requirements for the specific username 
       using ``chk_mobile_auth(username)`` every time username changes(if you are using interactive login).
       If OTP binding is required, you need to show instructions for binding OTP tokens, 
       at https://iaaa.pku.edu.cn/iaaa/resources/help/otpHelp.html.
    4. Get SMS code if needed using ``send_sms_code(username)``, 
       you must place 60s interval between each SMS code request.
    5. Call ``password_login(username, password, captcha, sms_code, otp_code)`` to perform login.
       If login fails due to any reason and CAPTCHA is required, 
       you should get a new CAPTCHA before try again.

    - QR code login:
    1. Initialize client with app_id, redirect_url, method=LoginMethod.QR and optional session,
       or call switch_method(LoginMethod.QR) from an initialized client.
    2. Get QR code image using ``get_QR()`` and display it for scanning.
    3. Poll login status using ``poll_qr_login()`` until login is successful,
       you should call ``get_QR()`` again after 1 minute due to QR code expiration.
    
    - Basic methods:
    1. ``get``: Wrapper for session.get, can be used directly for requests.
    2. ``post``: Wrapper for session.post, can be used directly for requests
    '''
    def __init__(self, app_id: str, redirect_url: str,
                  method: LoginMethod = LoginMethod.PASSWORD, 
                  session: Optional[requests.Session] = None):
        '''
        Initialize PKUIAAALoginClient.

        :param app_id: The application ID registered with PKU IAAA. Required for OAuth flows.
        :type app_id: str
        :param redirect_url: The redirect URL registered with PKU IAAA.
        :type redirect_url: str
        :param method: The login method to use. Defaults to LoginMethod.PASSWORD.
        :type method: LoginMethod, optional
        :param session: The session to use for requests. Defaults to empty Session with default configuration.
        :type session: requests.Session, optional
        :raises PKUIAAAError: Occurs when initialization fails due to connectivity or public key retrieval issues.
        '''
        super().__init__(session=session)

        # Basic configuration
        self.base_url = "https://iaaa.pku.edu.cn/iaaa"

        self.method = method
        self.app_id = app_id
        self.redirect_url = redirect_url

        # Authentication requirements
        self._init_reqs = self._init_auth_reqs()
        self.auth_reqs = self._init_reqs
        
        
        # Test connectivity and initialize session
        resp = self.get(f"{self.base_url}/oauth.jsp", 
                                 params={'appID': app_id, 'redirectUrl': redirect_url})
        if not resp.ok:
            raise PKUIAAAError("init: Connection Failure", code=resp.status_code)

        # Retrieve public key for password encryption
        resp = self.get(f"{self.base_url}/getPublicKey.do")
        if resp.ok and resp.json().get('success', False):
            self.public_key = RSA.import_key(resp.json().get('key', ''))
        else:
            raise PKUIAAAError("init: Public Key Retrieval Failure",
                                code=resp.status_code if resp else None)
    
    def switch_method(self, new_method: LoginMethod):
        '''
        Switch login method. For password method, you need
        to recheck authentication requirements.

        :param new_method: The new login method to switch to.
        :type new_method: LoginMethod
        :raises PKUIAAAError: Occurs when switching to password method fails due to public key retrieval issues.
        '''
        # Update login method
        self.method = new_method
        self._init_reqs = self._init_auth_reqs()  # Recheck auth requirements for the new method
        self.auth_reqs = self._init_reqs

    def _init_auth_reqs(self) -> LoginReqs:
        '''
        Check if QRCode or CAPTCHA is required for login.
        You must update ``self.method`` before calling this function, 
        as the requirements depend on the login method.

        :raises PKUIAAAError: Occurs when the CAPTCHA requirement check request fails.
        '''
        if self.method == LoginMethod.QR:
            # although this should not be called for QR method
            # but there's no need to throw error, just return QR requirement
            self.auth_reqs = LoginReqs.QR
            return LoginReqs.QR
        
        resp = self.get(f"{self.base_url}/isShowCode.do")
        if resp.ok:
            captcha = resp.json().get('success', False)
            if captcha:
                return LoginReqs.CAPTCHA
            else:
                return LoginReqs.NONE
        else:
            raise PKUIAAAError("check auth reqs: CAPTCHA Check Failure", code=resp.status_code if resp else None)

    def chk_mobile_auth(self, username: str) -> dict:
        '''
        Check SMS/OTP authentication requirements for the given username
        and updates ``self.auth_reqs``.
        This should only be called for password login method to 
        determine if CAPTCHA, SMS, or OTP is needed.

        :param username: PKU IAAA username
        :type username: str
        :raises PKUIAAAError: Occurs when the mobile authentication requirement check request fails.
        :return: JSON response from the server.
        :rtype: dict

        ## Notes
        ### Successful response structure:
        ```
        {
            "success": true,
            "mobileMask": "...",            # phone number mask
            "isMobileAuthen": true/false,   # requires SMS/OTP authentication?
            "authenMode": "否"/"SMS"/"OTP", # authentication mode if isMobileAuthen is true
            "isBind": true/false,           # whether the user has bound their phone or OTP token
            "isUnuAuth": true,              # you do not need to care about this field, just ignore it
            "bzAuthMode": ""                # you do not need to care about this field, just ignore it
        }
        ```
        Note that blank appID will lead to ``isBind=false`` for all users, 
        even those who have already bound their phone/OTP token, which may cause confusion.

        ### Failed response structure:
        ```
        {
            "success": false,
            "errors": {
                "code": "...",
                "msg": "..."
            },
            ...
        }
        ```
        Error code reference (not exhaustive):
        - E07 - Validation failed (incorrect username or other reasons)
        '''
        reqs = self._init_reqs

        # Mobile authentication check is not applicable for QR login method
        if self.method == LoginMethod.QR:
            raise PKUIAAAError("check mobile auth: Mobile Authentication Check is not applicable for QR login method")
        
        # Check if SMS or OTP is required for this username
        params = {
            'userName': username,
            'appId': self.app_id,
            '_rand': random.random()
        }
        resp = self.get(f"{self.base_url}/isMobileAuthen.do", params=params)
        if resp.ok:
            json = resp.json()
            self.auth_reqs = reqs
            if json.get('success', False) and json.get('isMobileAuthen', False):
                auth_mode = json.get('authenMode', '')
                if auth_mode == 'SMS': reqs = LoginReqs(reqs | LoginReqs.SMS)
                if auth_mode == 'OTP': 
                    reqs = LoginReqs(reqs | LoginReqs.OTP)
                    if not json.get('isBind', False):
                        reqs = LoginReqs(reqs | LoginReqs.BIND_OTP)
                self.auth_reqs = reqs
            return json
        else:
            raise PKUIAAAError("check mobile auth: Mobile Authen Requirement Check Failure", code=resp.status_code if resp else None)

    def get_QR(self, username: Optional[str] = None) -> str:
        '''
        Get jpg image for QR code

        :param username: PKU IAAA username.
        :type username: str, optional
        :raises PKUIAAAError: Failed to generate QR code due to any reason (e.g. network issues, library errors).
        :return: Base64 encoded jpg image content of the QR code.
        :rtype: str
        '''
        params = {
            'userName': username or '',
            'appId': self.app_id,
            '_rand': random.random()
        }
        
        response = self.get(f"{self.base_url}/genQRCode.do", params=params)

        if response.ok:
            return base64.b64encode(response.content).decode()
        else:
            raise PKUIAAAError("get QR: QR Code Retrieval Failure", code=response.status_code)
    
    def get_captcha(self) -> str:
        '''
        Get jpg CAPTCHA image.

        :raises PKUIAAAError: Occurs when CAPTCHA image retrieval fails.
        :return: Base64 encoded jpg CAPTCHA image content.
        :rtype: str
        '''
        params = {'Rand': random.random()}

        resp = self.get(f"{self.base_url}/servlet/DrawServlet", params=params)
        if resp.ok:
            return base64.b64encode(resp.content).decode()
        else:
            raise PKUIAAAError("get captcha: CAPTCHA Image Retrieval Failure", code=resp.status_code)
    
    def send_sms_code(self, username: str) -> dict:
        '''
        Send code via phone message.

        :param username: PKU IAAA username for which to send the SMS code.
        :type username: str
        :raises PKUIAAAError: Occurs when SMS code sending fails.
        :return: JSON response from the server.
        :rtype: dict

        ## Notes
        ### Successful response structure:
        ```
        {
            "success": true,
            "mobileMask": "...", # phone number mask
            ...
        }
        ```

        ### Failed response structure:
        ```
        {
            "success": false,
            "msg": "..."
        }
        ```
        Error message reference (not exhaustive):
        - 您没有绑定手机号或者无需短信验证登录。
        '''
        params = {
            'userName': username,
            'appId': self.app_id,
            '_rand': random.random()
        }
        resp = self.get(f"{self.base_url}/sendSMSCode.do", params=params)
        if resp.ok:
            return resp.json()
        else:
            raise PKUIAAAError("send SMS code: SMS Code Sending Failure", code=resp.status_code)
    
    def password_login(self, username: str, password: str, 
                       captcha: str = '', 
                       sms_code: str = '', 
                       otp_code: str = '') -> dict:
        '''
        Perform password login with the given username and password,
        note to refresh CAPTCHA if CAPTCHA is required and login fails.
        This gets SSOLogin ready after successful login, 
        so that the session is ready for access to resources requiring authentication.

        :param username: PKU IAAA username.
        :type username: str
        :param password: PKU IAAA password.
        :type password: str
        :param captcha: CAPTCHA code if required. Defaults to ''.
        :type captcha: str, optional
        :param sms_code: SMS code if required. Defaults to ''.
        :type sms_code: str, optional
        :param otp_code: OTP code if required. Defaults to ''.
        :type otp_code: str, optional
        :raises PKUIAAAError: Occurs when password encryption fails or when the login request fails.
        :return: JSON response from the server.
        :rtype: dict

        ## Notes
        ### Successful response structure:
        ```
        {
            "success": true,
            "token": "...", # token for SSO login
        }
        ```
        Note that SSOLogin is immediately performed after successful password login, 
        you should directly use the current session instead of handle the token yourself, 
        and reusing token will lead to SSO login failure.
        In other words, you should only focus on ``"success"`` field in the response to determine 
        if login is successful or not.

        ### Failed response structure:
        ```
        {
            "success": false,
            "errors": {
                "code": "...",
                "msg": "..."
            },
            "isFlag": true, # indicates weak password that needs to be changed, this field is not always present
            ...
        }
        ```
        Error code reference (not exhaustive):
        - E01 - Username or password error
        - E02 - Account not activated
        - E03 - CAPTCHA error
        - E04 - SMS code error
        - E05 - OTP code error
        - E99 - Operation failed (incorrect params or other reasons)
        - Error code for weak password is unknown, but you can check ``"isFlag"`` field for this error.
        
        For all error codes, the error message from ``"msg"`` field should be shown to users.
        '''
        assert self.method == LoginMethod.PASSWORD, "password_login should only be called for PASSWORD login method"

        # Password encryption using RSA public key
        try:
            cipher = PKCS1_v1_5.new(self.public_key)
            encrypted = cipher.encrypt(password.encode())
            encrypted_pwd = base64.b64encode(encrypted).decode()
        except:
            raise PKUIAAAError("password login: Password Encryption Failure")
        
        # Collect login data
        data = {
            'userName': username,
            'password': encrypted_pwd,
            'randCode': captcha,
            'smsCode': sms_code,
            'otpCode': otp_code,
            'appid': self.app_id,
            'remTrustChk': 'false',
            'redirUrl': self.redirect_url
        }
        url = f"{self.base_url}/oauthlogin.do"
        
        resp = self.post(url, data=data)
        if resp.ok:
            json = resp.json()
            if json.get('success', False):
                # After successful login, perform SSO login to establish session
                token = json.get('token')
                self._sso_login(token)
            return json
        else:
            raise PKUIAAAError("password login: Login Request Failure", code=resp.status_code)
    
    def poll_qr_login(self) -> dict:
        '''
        Perform polling for QR code login status. 
        Should be called repeatedly after generating and 
        displaying the QR code until login is successful.
        This gets SSOLogin ready after successful login, 
        so that the session is ready for access to resources requiring authentication.

        :raises PKUIAAAError: Occurs when the polling request fails.
        :return: JSON response from the server.
        :rtype: dict

        ## Notes
        ### Successful response structure:
        ```
        {
            "success": true,
            "token": "...", # token for SSO login
        }
        ```
        Note that SSOLogin is immediately performed after successful password login, 
        you should directly use the current session instead of handle the token yourself, 
        and reusing token will lead to SSO login failure.
        In other words, you should only focus on ``"success"`` field in the response to determine 
        if login is successful or not.

        ### Failed response structure:
        ```
        {
            "success": false,
            "errors": {
                "code": "...",
                "msg": "..."
            },
            "isStop": "是", # indicates a calling error, this field is not always present
            ...
        }
        ```
        Error code reference (not exhaustive):
        - E02 - Account not activated
        - E06 - OTP binding required
        - E10 - No valid binding (did not fetch QR code, or it has not been scanned)
        - E11 - Invalid calling params
        - E99 - Operation failed (unknown reason)

        For code E02, E06, E10, polling should continue until success or timeout, 
        for other error codes(``"isStop" == "是" or "code" == "E99"``), polling should be stopped immediately.
        For code other than E10, error message should be shown to users, 
        but for E10, it is usual status before users scan the QR code, 
        so the error message should be ignored.
        '''
        assert self.method == LoginMethod.QR, "poll_qr_login should only be called for QR login method"

        poll_url = f"{self.base_url}/oauthlogin4QRCode.do"
        data = {
            'appId': 'PKUApp',
            'issuerAppId': 'iaaa',
            'targetAppId': self.app_id,
            'redirectUrl': self.redirect_url
        }
        
        resp = self.post(poll_url, data=data)
        if resp.ok:
            json = resp.json()
            if json.get('success', False):
                # After successful QR login, perform SSO login to establish session
                token = json.get('token')
                self._sso_login(token)
            return json
        else:
            raise PKUIAAAError("poll QR login: Polling Request Failure", code=resp.status_code)

    def _sso_login(self, token: str):
        '''
        Perform SSO login using the provided token.

        :param token: The token obtained from successful authentication.
        :type token: str
        :raises PKUIAAAError: Occurs when the SSO login request fails.
        '''
        params = {
            'token': token,
            '_rand': random.random()
        }

        resp = self.get(self.redirect_url, params=params)
        if not resp.ok:
            raise PKUIAAAError("SSO login: SSO Login Request Failure", code=resp.status_code)
        
class Portal2017LoginClient(PKUIAAALoginClient):
    '''
    The login client for PKU portal 2017

    Supported login methods:
    - PASSWORD: Traditional username/password login with optional CAPTCHA, SMS, and OTP verification.
    - QR: QR code login using the official "Peking University" app.

    **Usage:**
    - Password login:
    1. Initialize client with app_id, redirect_url, method=LoginMethod.PASSWORD and optional session,
       or call switch_method(LoginMethod.PASSWORD) from an initialized client.
    2. Check CAPTCHA requirements from ``auth_reqs`` and get CAPTCHA if needed.
    3. Update authentication requirements for the specific username 
       using ``upd_auth_reqs(username)`` every time username changes(if you are using interactive login).
    4. Get SMS code if needed using ``send_sms_code(username)``.
    5. Call ``password_login(username, password, captcha, sms_code, otp_code)`` to perform login.

    - QR code login:
    1. Initialize client with app_id, redirect_url, method=LoginMethod.QR and optional session,
       or call switch_method(LoginMethod.QR) from an initialized client.
    2. Get QR code image using ``get_QR()`` and display it for scanning.
    3. Poll login status using ``poll_qr_login()`` until login is successful,
       you should call ``get_QR()`` again after 60 queries due to QR code expiration.
    
    - Basic and additional methods:
    1. ``get``: Wrapper for session.get, can be used directly for requests.
    2. ``post``: Wrapper for session.post, can be used directly for requests
    3. ``chk_login_status()``: Check current login status.
    4. ``portlet_redir(portlet_id)``: Access a specific portlet by its ID to establish necessary session state. Should be called only after successful login.
    '''
    def __init__(self, method: LoginMethod = LoginMethod.PASSWORD, 
                 session: Optional[requests.Session] = None):
        '''
        Initialize Portal2017LoginClient with predefined app_id and redirect_url for PKU Portal 2017.

        :param method: The login method to use. Defaults to LoginMethod.PASSWORD.
        :type method: LoginMethod, optional
        :param session: The session to use for requests. Defaults to empty Session with default configuration.
        :type session: requests.Session, optional
        '''
        super().__init__(
            app_id="portal2017",
            redirect_url="https://portal.pku.edu.cn/portal2017/ssoLogin.do",
            method=method,
            session=session
        )

    def chk_login_status(self) -> dict:
        '''
        Check current login status.

        :raises PKUIAAAError: Occurs when the login status check request fails.
        :return: JSON response from the server.
        :rtype: dict

        ## Notes
        ### Successful response structure:
        ```
        {
            "success": true,
            "userId": "2400017711", # PKU IAAA user ID
            "userName": "xxx",      # User's real name
            "userType": "学生",
            "accessFromApp": "否",
            "language": "zh"
        }
        ```

        ### Failed response structure:
        ```
        {
            "success": false,
            "code": 10001,
            "msg": "空指针错误"
        }
        ```
        This indicates that the session is not authenticated, 
        and you should perform login before accessing protected resources.
        '''
        resp = self.get("https://portal.pku.edu.cn/portal2017/isUserLogged.do")
        if resp.ok:
            return resp.json()
        else:
            raise PKUIAAAError("check login status: Login Status Check Failure", code=resp.status_code)
    
    def portlet_redir(self, portlet_id: str):
        '''
        Access a specific portlet by its ID to establish necessary session state.
        Always check login status by calling ``chk_login_status()`` before calling this function, 
        and ensure correctness of ``portlet_id``, or the portlet redirection may fail silently.

        :param portlet_id: The ID of the portlet to access (e.g., 'myscores', 'coursetable').
        :type portlet_id: str
        :raises PKUIAAAError: Occurs when the portlet redirection request fails.

        The portlets available is too many to be listed here, 
        but you can find the portlet ID from the URL when you access the portlet in browser
        from the portal homepage after login.
        '''
        params = {
            'portletId': portlet_id
        }
        resp = self.get("https://portal.pku.edu.cn/portal2017/util/portletRedir.do", params=params)
        if not resp.ok:
            raise PKUIAAAError(f"portlet redirection: Portlet Redirection Failure for {portlet_id}", code=resp.status_code)

class CourseClient(PKUIAAALoginClient):
    '''
    The login client for PKU course web

    Supported login methods:
    - PASSWORD: Traditional username/password login with optional CAPTCHA, SMS, and OTP verification.
    - QR: QR code login using the official "Peking University" app.

    **Usage:**
    - Password login:
    1. Initialize client with app_id, redirect_url, method=LoginMethod.PASSWORD and optional session,
       or call switch_method(LoginMethod.PASSWORD) from an initialized client.
    2. Check CAPTCHA requirements from ``auth_reqs`` and get CAPTCHA if needed.
    3. Update authentication requirements for the specific username
       using ``chk_mobile_auth(username)`` every time username changes(if you are using interactive login).
    4. Get SMS code if needed using ``send_sms_code(username)``.
    5. Call ``password_login(username, password, captcha, sms_code, otp_code)`` to perform login.

    - QR code login:
    1. Initialize client with app_id, redirect_url, method=LoginMethod.QR and optional session,
       or call switch_method(LoginMethod.QR) from an initialized client.
    2. Get QR code image using ``get_QR()`` and display it for scanning.
    3. Poll login status using ``poll_qr_login()`` until login is successful,
       you should call ``get_QR()`` again after 60 queries due to QR code expiration.

    - Basic and additional methods:
    1. ``get``: Wrapper for session.get, can be used directly for requests.
    2. ``post``: Wrapper for session.post, can be used directly for requests.
    3. ``headers``: Shortcut for session.headers, can be used to update headers when needed.
    '''
    def __init__(self, method: LoginMethod = LoginMethod.PASSWORD,
                 session: Optional[requests.Session] = None):
        '''
        Initialize CourseClient with predefined app_id and redirect_url for PKU Course
        This prepares certificate bundle for secure connection to Course as well.
        :param method: The login method to use. Defaults to LoginMethod.PASSWORD.
        :type method: LoginMethod, optional
        :param session: The session to use for requests. Defaults to empty Session with default configuration.
        :type session: requests.Session, optional
        '''
        super().__init__(
            app_id="blackboard",
            redirect_url="http://course.pku.edu.cn/webapps/bb-sso-BBLEARN/execute/authValidate/campusLogin",
            method=method,
            session=session
        )

        cert_path = os.path.join(tempfile.gettempdir(), "course_cert_bundle.pem")
        if not os.path.exists(cert_path):
            try:
                cert = ssl.get_server_certificate(('course.pku.edu.cn', 443))
                with open(certifi.where(), 'r', encoding='utf-8') as f:
                    base_certs = f.read()
                with open(cert_path, 'w', encoding='utf-8') as f:
                    f.write(base_certs + '\n' + cert)
            except Exception:
                pass

        if os.path.exists(cert_path):
            self.session.verify = cert_path

class Channel(Enum):
    '''
    Enum for elective channels, used for sso login channel selection.
    - MAJOR: Student channel with access to course selection, etc.
    - MINOR: Student channel with access to course selection, etc.
    '''
    MAJOR = "bzx"
    MINOR = "bfx"

class Elective2008Client(PKUIAAALoginClient):
    '''
    The login client for PKU Elective 2008

    Supported login methods:
    - PASSWORD: Traditional username/password login with optional CAPTCHA, SMS, and OTP verification.
    - QR: QR code login using the official "Peking University" app.

    **Usage:**
    - Password login:
    1. Initialize client with app_id, redirect_url, method=LoginMethod.PASSWORD and optional session,
       or call switch_method(LoginMethod.PASSWORD) from an initialized client.
    2. Check CAPTCHA requirements from ``auth_reqs`` and get CAPTCHA if needed.
    3. Update authentication requirements for the specific username
       using ``chk_mobile_auth(username)`` every time username changes(if you are using interactive login).
    4. Get SMS code if needed using ``send_sms_code(username)``.
    5. Call ``password_login(username, password, captcha, sms_code, otp_code)`` to perform login.

    - QR code login:
    1. Initialize client with app_id, redirect_url, method=LoginMethod.QR and optional session,
       or call switch_method(LoginMethod.QR) from an initialized client.
    2. Get QR code image using ``get_QR()`` and display it for scanning.
    3. Poll login status using ``poll_qr_login()`` until login is successful,
       you should call ``get_QR()`` again after 60 queries due to QR code expiration.

    - Basic and additional methods:
    1. ``get``: Wrapper for session.get with automatic referer setting, can be used directly for requests.
    2. ``post``: Wrapper for session.post with automatic referer setting, can be used directly for requests.
    3. ``headers``: Shortcut for session.headers, can be used to update headers when needed.
    '''

    def __init__(self, method: LoginMethod = LoginMethod.PASSWORD,
                 channel: Channel = Channel.MAJOR,
                 session: Optional[requests.Session] = None):
        '''
        Initialize Elective2008Client with predefined app_id and redirect_url for PKU Elective 2008.
        :param method: The login method to use. Defaults to LoginMethod.PASSWORD.
        :type method: LoginMethod, optional
        :param channel: The default channel to use for login. Defaults to Channel.MAJOR.
        :type channel: Channel, optional
        :param session: The session to use for requests. Defaults to empty Session with default configuration.
        :type session: requests.Session, optional
        '''
        self.channel = channel

        super().__init__(
            app_id="syllabus",
            redirect_url="http://elective.pku.edu.cn:80/elective2008/ssoLogin.do",
            method=method,
            session=session
        )

    def _sso_login(self, token: str):
        '''
        Perform SSO login using the provided token.
        This performs channel selection if needed, and updates
        referer processing utilities for subsequent requests.

        :param token: The token obtained from successful authentication.
        :type token: str
        :raises PKUIAAAError: Occurs when the SSO login request fails.
        '''

        params = {
            'token': token,
            '_rand': random.random()
        }

        resp = self.get(self.redirect_url, params=params)
        if not resp.ok:
            raise PKUIAAAError("SSO login: SSO Login Request Failure", code=resp.status_code)

        # replace get/post, add auto tracking of referer
        def get(url, **kwargs):
            """
            Sends a GET request and updates Referer header if successful.
            """
            response = self.session.get(url, **kwargs)
            if response.ok:
                self.headers.update({
                    'Referer': response.url
                })
            return response
        self.get = get
        def post(url, **kwargs):
            """
            Sends a POST request and updates Referer header if successful.
            """
            response = self.session.post(url, **kwargs)
            if response.ok:
                self.headers.update({
                    'Referer': response.url
                })
            return response
        self.post = post

        # try determine if channel selection is needed
        re_model = r"http://elective\.pku\.edu\.cn:80/elective2008/scnStAthVef\.jsp/\.\./ssoLogin\.do\?sida=([^&]+)&sttp=" + self.channel.value
        url_search = re.search(
            re_model,
            resp.text.strip()
        )

        if url_search:
            sso_target = url_search.group(0)
            resp = self.get(sso_target)
            if not resp.ok:
                raise PKUIAAAError("SSO login: Channel Selection Redirection Failure", code=resp.status_code)
        else:
            self.channel = Channel.MAJOR # no minor channel selection, default to major
