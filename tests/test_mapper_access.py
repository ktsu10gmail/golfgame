import http.client
import io
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from scripts.mapper_access import COOKIE, MapperAccess, password_hash, same_origin
from scripts import serve


class MapperAccessTests(unittest.TestCase):
    def test_password_rate_limit_logout_and_expiration(self):
        access = MapperAccess(password_hash("a-good-test-password"), "test-token")
        for _ in range(5):
            self.assertEqual(access.login("wrong", "client")[1], 401)
        self.assertEqual(access.login("a-good-test-password", "client")[1], 429)
        token, status = access.login("a-good-test-password", "another-client")
        self.assertEqual(status, 200)
        cookie = f"{COOKIE}={token}"
        self.assertTrue(access.authenticated(cookie))
        access.logout(cookie)
        self.assertFalse(access.authenticated(cookie))
        token, _ = access.login("a-good-test-password", "another-client")
        access.sessions[token] = 0
        self.assertFalse(access.authenticated(f"{COOKIE}={token}"))

    def test_service_boundary_and_origin(self):
        access = MapperAccess(service_token="test-token")
        self.assertTrue(access.service_authorized("test-token", "127.0.0.1"))
        self.assertFalse(access.service_authorized("test-token", "192.168.1.35"))
        self.assertFalse(access.service_authorized("wrong", "127.0.0.1"))
        self.assertFalse(MapperAccess().service_authorized("", "127.0.0.1"))
        self.assertFalse(same_origin({"Origin": "https://other.example", "Host": "mapper.example"}))
        self.assertFalse(same_origin({"Sec-Fetch-Site": "cross-site"}))
        self.assertTrue(same_origin({"Origin": "https://mapper.example", "Host": "mapper.example"}))

    def test_app_service_identity_does_not_use_player_authentication(self):
        handler = object.__new__(serve.AppHandler)
        handler.path = "/api/v1/course-production/queue"
        handler.headers = {"X-Jetta-Mapper-Service": "test-token"}
        handler.client_address = ("127.0.0.1", 9000)
        handler._json_response = lambda status, payload: None
        with patch.object(serve, "SERVER_ROLE", "app"), patch.object(serve, "MAPPER_ACCESS", MapperAccess(service_token="test-token")), patch.object(handler, "_current_player", side_effect=AssertionError("Player auth must not be called")):
            self.assertEqual(handler._require_developer(), {"id": None, "actor_type": "MAPPER_SERVICE"})
            handler.client_address = ("192.168.1.35", 9000)
            self.assertIsNone(handler._require_developer())
            handler.client_address = ("127.0.0.1", 9000)
            handler.headers = {"X-Jetta-Mapper-Service": "wrong"}
            self.assertIsNone(handler._require_developer())


class MapperLoginHttpTests(unittest.TestCase):
    def setUp(self):
        self.access = MapperAccess(password_hash("a-good-test-password"), "test-service-token")
        self.patches = [patch.object(serve, "SERVER_ROLE", "mapper"), patch.object(serve, "MAPPER_ACCESS", self.access)]
        for item in self.patches:
            item.start()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), serve.AppHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        for item in reversed(self.patches):
            item.stop()

    def request(self, method, path, payload=None, cookie=None, extra=None):
        headers = {"Content-Type": "application/json", **(extra or {})}
        if cookie:
            headers["Cookie"] = cookie
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        connection.request(method, path, body=json.dumps(payload) if payload is not None else None, headers=headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), json.loads(response.read())
        connection.close()
        return result

    def test_login_proxy_and_logout(self):
        route = "/api/v1/course-import/openstreetmap/status"
        self.assertEqual(self.request("GET", route)[0], 401)
        self.assertEqual(self.request("POST", "/api/mapper/login", {"password": "wrong"})[0], 401)
        status, headers, result = self.request("POST", "/api/mapper/login", {"password": "a-good-test-password"}, extra={"X-Forwarded-Proto": "https"})
        self.assertEqual(status, 200)
        cookie = headers["Set-Cookie"].split(";", 1)[0]
        for flag in ("HttpOnly", "SameSite=Strict", "Secure"):
            self.assertIn(flag, headers["Set-Cookie"])
        self.assertNotIn("test-service-token", json.dumps(result))
        self.assertTrue(self.request("GET", "/api/mapper/session", cookie=cookie)[2]["authenticated"])
        upstream = io.BytesIO(b'{"ready_for_search": true}')
        upstream.code = 200
        with patch.object(serve, "urlopen", return_value=upstream) as mocked:
            status, _, result = self.request("GET", route, cookie=cookie, extra={"X-Jetta-Mapper-Service": "browser-spoof"})
            self.assertEqual(status, 200)
            self.assertTrue(result["ready_for_search"])
            request = mocked.call_args.args[0]
            self.assertEqual(request.full_url, "http://127.0.0.1:8080" + route)
            self.assertEqual(request.get_header("X-jetta-mapper-service"), "test-service-token")
        self.assertEqual(self.request("POST", "/api/mapper/logout", cookie=cookie)[0], 200)
        self.assertEqual(self.request("GET", route, cookie=cookie)[0], 401)

    def test_cross_site_and_app_routes_rejected(self):
        self.assertEqual(self.request("POST", "/api/mapper/login", {"password": "a-good-test-password"}, extra={"Origin": "https://attacker.example"})[0], 403)
        for route in ("/api/admin/session", "/api/auth/config", "/api/player/session"):
            self.assertEqual(self.request("GET", route)[0], 404)
        token, _ = self.access.login("a-good-test-password", "client")
        self.assertEqual(self.request("POST", "/api/course-mapper/install", {}, cookie=f"{COOKIE}={token}", extra={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.request("PUT", "/api/player/profile", {})[0], 404)

    def test_course_library_requires_login_and_server_only_proxy_credential(self):
        route = '/api/v1/course-library/courses?q=NJ'
        self.assertEqual(self.request('GET',route)[0],401)
        token,_ = self.access.login('a-good-test-password','client')
        cookie = f'{COOKIE}={token}'
        self.assertEqual(self.request('POST','/api/v1/course-library/queue',{'ids':['course-test']},cookie=cookie,
                                      extra={'Sec-Fetch-Site':'cross-site'})[0],403)
        upstream=io.BytesIO(b'{"courses":[],"total":0}')
        upstream.code=200
        with patch.object(serve,'urlopen',return_value=upstream) as mocked:
            status,_,result=self.request('GET',route,cookie=cookie)
            self.assertEqual(status,200)
            self.assertEqual(result['total'],0)
            self.assertNotIn('test-service-token',json.dumps(result))
            self.assertEqual(mocked.call_args.args[0].get_header('X-jetta-mapper-service'),'test-service-token')
