"""Authorization and loopback HTTP checks; no live accounts or Google requests."""
import http.client
import importlib.util
import io
import json
from pathlib import Path
import threading
import unittest
from urllib.error import HTTPError, URLError

MODULE = Path(__file__).parents[1] / "public/tools/yidream-owner-import.py"
SPEC = importlib.util.spec_from_file_location("owner_import", MODULE)
gateway = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gateway)


class Response(io.BytesIO):
    def __init__(self, content, media="application/json", size=None):
        super().__init__(content)
        self.headers = {"Content-Type": media}
        if size is not None:
            self.headers["Content-Length"] = str(size)


class OwnerAuthorizationTests(unittest.TestCase):
    def test_missing_or_malformed_token_never_contacts_supabase(self):
        def unexpected(*args, **kwargs):
            self.fail("An invalid token must fail before contacting Supabase")
        for value in [None, "", "Basic token", "Bearer ", "Bearer invalid token", "Bearer " + "x" * 16385]:
            with self.subTest(value=str(value)[:30]), self.assertRaises(gateway.AccessDenied) as error:
                gateway.require_owner(value, unexpected)
            self.assertEqual(error.exception.status, 401)

    def test_token_is_verified_by_auth_and_current_owner_rpc(self):
        calls = []
        def opener(request, **kwargs):
            calls.append(request)
            return Response(json.dumps({"id": "owner-id"} if len(calls) == 1 else True).encode())
        gateway.require_owner("Bearer test-session", opener)
        self.assertEqual([r.full_url for r in calls], [gateway.SUPABASE_URL + "/auth/v1/user", gateway.SUPABASE_URL + "/rest/v1/rpc/is_platform_owner"])
        self.assertEqual(calls[1].get_method(), "POST")
        self.assertEqual(calls[1].data, b"{}")
        self.assertTrue(all(r.get_header("Authorization") == "Bearer test-session" for r in calls))

    def test_nonowner_suspended_owner_and_forged_role_fail_closed(self):
        for role_result in [False, None, {}, {"role": "owner"}, "true", 1]:
            calls = []
            def opener(request, **kwargs):
                calls.append(request)
                return Response(json.dumps({"id": "a-user", "user_metadata": {"role": "owner"}} if len(calls) == 1 else role_result).encode())
            with self.subTest(role_result=role_result), self.assertRaises(gateway.AccessDenied) as error:
                gateway.require_owner("Bearer test-session", opener)
            self.assertEqual(error.exception.status, 403)

    def test_expired_session_and_authority_outage_are_rejected(self):
        for upstream_error, expected in [(HTTPError("fixed", 401, "expired", {}, None), 401), (HTTPError("fixed", 500, "outage", {}, None), 503), (URLError("offline"), 503)]:
            def opener(*args, **kwargs):
                raise upstream_error
            with self.subTest(expected=expected), self.assertRaises(gateway.AccessDenied) as error:
                gateway.require_owner("Bearer test-session", opener)
            self.assertEqual(error.exception.status, expected)

    def test_redirects_are_not_followed(self):
        self.assertIsNone(gateway.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://elsewhere.example/"))


class GatewayHTTPTests(unittest.TestCase):
    def setUp(self):
        self.authorizations, self.provider_requests = [], []
        self.owner = True
        self.provider_media = "application/vnd.android.package-archive"
        self.provider_body = b"test-apk-content"
        test = self
        class Handler(gateway.OwnerImportHandler):
            @staticmethod
            def owner_authorizer(value):
                test.authorizations.append(value)
                if value != "Bearer owner-session":
                    raise gateway.AccessDenied(401, "Session invalide.")
                if not test.owner:
                    raise gateway.AccessDenied(403, "Compte non propriétaire.")

            @staticmethod
            def provider_opener(request, **kwargs):
                test.provider_requests.append(request)
                return Response(test.provider_body, test.provider_media)
        self.server = gateway.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method="GET", path="/api/download-merged/com.example.app?arch=arm64-v8a", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        result = (response.status, dict(response.getheaders()), response.read())
        connection.close()
        return result

    def authorized_headers(self, origin="https://yidreamkosher.github.io"):
        return {"Origin": origin, "Authorization": "Bearer owner-session"}

    def test_other_origin_and_anonymous_requests_never_reach_provider(self):
        for headers in [{}, {"Origin": "https://evil.example", "Authorization": "Bearer owner-session"}, {"Origin": "https://yidreamkosher.github.io"}]:
            with self.subTest(headers=headers):
                code, _, _ = self.request(headers=headers)
                self.assertIn(code, (401, 403))
        self.assertEqual(self.provider_requests, [])

    def test_current_role_is_checked_on_each_download_without_forwarding_session(self):
        code, headers, body = self.request(headers=self.authorized_headers())
        self.assertEqual((code, body), (200, self.provider_body))
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://yidreamkosher.github.io")
        self.assertEqual(self.provider_requests[0].full_url, "http://127.0.0.1:5001/api/download-merged/com.example.app?arch=arm64-v8a")
        self.assertIsNone(self.provider_requests[0].get_header("Authorization"))
        self.assertIsNone(self.provider_requests[0].get_header("Apikey"))
        self.owner = False
        self.assertEqual(self.request(headers=self.authorized_headers())[0], 403)
        self.assertEqual(len(self.authorizations), 2)
        self.assertEqual(len(self.provider_requests), 1)

    def test_paths_queries_and_architectures_cannot_turn_gateway_into_proxy(self):
        for path in ["/api/download-merged/com.example.app?url=https://evil.example", "/api/download-merged/com.example.app?arch=arm64-v8a&arch=x86", "/api/download-merged/com.example.app?arch=bad", "/api/info/com.example.app?arch=x86", "/api/info/com.%2e%2e%2fsecret", "/api/info/1.invalid", "/api/info/" + "a" * 256 + ".app", "/api/auth/login", "/https://evil.example/api/info/com.app"]:
            with self.subTest(path=path):
                self.assertIn(self.request(path=path, headers=self.authorized_headers())[0], (400, 404))
        self.assertEqual(self.provider_requests, [])
        self.assertEqual(self.authorizations, [])

    def test_current_official_origin_can_preflight_but_retired_and_unlisted_origins_cannot(self):
        for origin in gateway.CONSOLE_ORIGINS:
            code, headers, body = self.request(method="OPTIONS", headers={"Origin": origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"})
            self.assertEqual(code, 204)
            self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
            self.assertEqual(body, b"")
        for origin in ["https://qinfrance.github.io", "https://yidreamkosher.github.io.evil.example"]:
            self.assertEqual(self.request(method="OPTIONS", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})[0], 403)
            self.assertEqual(self.request(headers=self.authorized_headers(origin))[0], 403)
        self.assertEqual(self.provider_requests, [])

    def test_unexpected_or_empty_provider_output_fails_before_success(self):
        self.provider_body = b"<html>not an APK</html>"
        self.provider_media = "text/html"
        self.assertEqual(self.request(headers=self.authorized_headers())[0], 502)
        self.provider_media = "application/vnd.android.package-archive"
        self.provider_body = b""
        self.assertEqual(self.request(headers=self.authorized_headers())[0], 502)

    def test_health_contains_no_account_or_provider_data(self):
        code, _, body = self.request(path="/health")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["status"], "ok")
        self.assertEqual(self.authorizations, [])
        self.assertEqual(self.provider_requests, [])


if __name__ == "__main__":
    unittest.main()
