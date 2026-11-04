#!/usr/bin/env python3
"""Loopback-only owner-authorized gateway for a separately installed Play provider.

No Google credentials are handled here. The owner's Supabase JWT is validated
against Auth and is_platform_owner on every request and never sent upstream.
"""
import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

SUPABASE_URL = "https://jqrznghqwdjbizjehzrm.supabase.co"
PUBLISHABLE_KEY = "sb_publishable_YG9zgjQ5Y56WiBtKdJMQvA_-UBAFv9B"
CONSOLE_ORIGINS = frozenset({"https://yidreamkosher.github.io"})
PROVIDER_URL = "http://127.0.0.1:5001"
MAX_APK_BYTES = 250 * 1024 * 1024
MAX_INFO_BYTES = 2 * 1024 * 1024
PACKAGE = re.compile(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+\Z")
ARCHITECTURES = {"arm64-v8a", "armeabi-v7a", "x86", "x86_64"}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# Neither session checks nor a fixed local provider may redirect to another host.
urlopen = build_opener(NoRedirect()).open


class AccessDenied(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def require_owner(authorization, opener=urlopen):
    """Supabase verifies the token; SQL checks the current active owner role."""
    if not authorization or not authorization.startswith("Bearer "):
        raise AccessDenied(401, "Connexion YiDream requise.")
    token = authorization[7:].strip()
    if not token or len(token) > 16384 or any(char.isspace() for char in token):
        raise AccessDenied(401, "Session YiDream invalide.")
    headers = {"apikey": PUBLISHABLE_KEY, "Authorization": "Bearer " + token}
    try:
        with opener(Request(SUPABASE_URL + "/auth/v1/user", headers=headers), timeout=12) as response:
            user = json.loads(response.read(65536))
        if not isinstance(user, dict) or not user.get("id"):
            raise AccessDenied(401, "Session YiDream invalide.")
        request = Request(SUPABASE_URL + "/rest/v1/rpc/is_platform_owner", data=b"{}",
                          headers={**headers, "Content-Type": "application/json"}, method="POST")
        with opener(request, timeout=12) as response:
            owner = json.loads(response.read(1024))
        if owner is not True:
            raise AccessDenied(403, "Cet import est réservé au propriétaire YiDream.")
    except AccessDenied:
        raise
    except HTTPError as error:
        if error.code in (401, 403):
            raise AccessDenied(401, "Session YiDream expirée ou non autorisée.") from None
        raise AccessDenied(503, "La vérification des droits YiDream est indisponible.") from None
    except (URLError, OSError, ValueError, TypeError):
        raise AccessDenied(503, "La vérification des droits YiDream est indisponible.") from None


def provider_request_path(path):
    """Only these two public-data provider operations can be reached."""
    parsed = urlsplit(path)
    match = re.fullmatch(r"/api/(info|download-merged)/([^/]+)", parsed.path)
    if not match or parsed.fragment:
        raise AccessDenied(404, "Opération introuvable.")
    operation, package = match.groups()
    package = unquote(package)
    if len(package) > 255 or not PACKAGE.fullmatch(package):
        raise AccessDenied(400, "Paquet Android invalide.")
    query = parse_qs(parsed.query, keep_blank_values=True)
    if operation == "info":
        if query:
            raise AccessDenied(400, "Paramètres non autorisés.")
        return "/api/info/" + quote(package, safe="."), package, MAX_INFO_BYTES
    if set(query) - {"arch"} or len(query.get("arch", [])) > 1:
        raise AccessDenied(400, "Paramètres non autorisés.")
    architecture = query.get("arch", ["arm64-v8a"])[0]
    if architecture not in ARCHITECTURES:
        raise AccessDenied(400, "Architecture Android non autorisée.")
    return "/api/download-merged/" + quote(package, safe=".") + "?arch=" + architecture, package, MAX_APK_BYTES


class OwnerImportHandler(BaseHTTPRequestHandler):
    server_version = "YiDreamOwnerImport/1"
    owner_authorizer = staticmethod(require_owner)
    provider_opener = staticmethod(urlopen)

    def log_message(self, format, *args):
        # Request URLs, headers and provider error bodies are never logged.
        return

    def cors_headers(self):
        origin = self.headers.get("Origin")
        if origin in CONSOLE_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def json_response(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        if self.headers.get("Origin") not in CONSOLE_ORIGINS:
            return self.json_response(403, {"error": "Origine non autorisée."})
        requested = {h.strip().lower() for h in self.headers.get("Access-Control-Request-Headers", "").split(",") if h.strip()}
        if self.headers.get("Access-Control-Request-Method") != "GET" or requested - {"authorization", "content-type"}:
            return self.json_response(403, {"error": "Requête non autorisée."})
        try:
            provider_request_path(self.path)
        except AccessDenied as error:
            return self.json_response(error.status, {"error": error.message})
        self.send_response(204)
        self.cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if self.path in ("/", "/health"):
            return self.json_response(200, {"status": "ok", "access": "YiDream owner session required"})
        try:
            if self.headers.get("Origin") not in CONSOLE_ORIGINS:
                raise AccessDenied(403, "Origine non autorisée.")
            path, package, limit = provider_request_path(self.path)
            self.owner_authorizer(self.headers.get("Authorization"))
            # Deliberately no Authorization, API key or cookies go to the provider.
            upstream_request = Request(PROVIDER_URL + path, headers={"Accept": "application/json" if path.startswith("/api/info/") else "application/vnd.android.package-archive"})
            with self.provider_opener(upstream_request, timeout=300) as response:
                size = response.headers.get("Content-Length")
                if size and (not size.isdecimal() or int(size) > limit):
                    raise AccessDenied(502, "Le service a renvoyé un fichier trop volumineux.")
                media = response.headers.get("Content-Type", "application/octet-stream").split(";", 1)[0].lower()
                allowed = {"application/json"} if path.startswith("/api/info/") else {"application/vnd.android.package-archive", "application/octet-stream", "application/zip"}
                if media not in allowed:
                    raise AccessDenied(502, "Le service a renvoyé un fichier inattendu.")
                # Spool before replying, so a size or stream failure never appears as a valid APK.
                import tempfile
                with tempfile.SpooledTemporaryFile(max_size=4 * 1024 * 1024) as output:
                    total = 0
                    while True:
                        chunk = response.read(65536)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > limit:
                            raise AccessDenied(502, "Le service a renvoyé un fichier trop volumineux.")
                        output.write(chunk)
                    if not total:
                        raise AccessDenied(502, "Le service a renvoyé un fichier vide.")
                    output.seek(0)
                    self.send_response(200)
                    self.cors_headers()
                    self.send_header("Content-Type", media)
                    self.send_header("Content-Length", str(total))
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    if path.startswith("/api/download-merged/"):
                        self.send_header("Content-Disposition", 'attachment; filename="' + package + '.apk"')
                    self.end_headers()
                    while True:
                        chunk = output.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
        except AccessDenied as error:
            self.json_response(error.status, {"error": error.message})
        except (HTTPError, URLError, OSError, ValueError, TypeError):
            self.json_response(502, {"error": "Le service Google Play local est indisponible ou a refusé la demande."})


def main():
    parser = argparse.ArgumentParser(description="YiDream owner-only local Play import gateway")
    parser.add_argument("--port", type=int, default=5000)
    options = parser.parse_args()
    if not 1024 <= options.port <= 65535:
        parser.error("Le port doit être compris entre 1024 et 65535.")
    server = ThreadingHTTPServer(("127.0.0.1", options.port), OwnerImportHandler)
    print("Passerelle YiDream active sur http://127.0.0.1:" + str(options.port) + ". Connexion propriétaire vérifiée à chaque import.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
