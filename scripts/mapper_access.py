"""Single-password Mapper sessions and private App-service credentials."""
import hashlib
import hmac
import secrets
import threading
import time
from http.cookies import SimpleCookie
from urllib.parse import urlsplit

COOKIE = "jetta_mapper_session"


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return f"scrypt${salt}${digest}"


class MapperAccess:
    def __init__(self, password_digest="", service_token=""):
        self.password_digest = password_digest
        self.service_token = service_token
        self.sessions = {}
        self.failures = {}
        self.lock = threading.Lock()

    def login(self, password, address):
        with self.lock:
            now = time.time()
            self.failures = {key: value for key, value in self.failures.items() if value[1] > now}
            attempts, deadline = self.failures.get(address, (0, now + 900))
            if attempts >= 5:
                return None, 429
            try:
                algorithm, salt, _ = self.password_digest.split("$")
                valid = algorithm == "scrypt" and hmac.compare_digest(password_hash(password, salt), self.password_digest)
            except (ValueError, TypeError, AttributeError):
                valid = False
            if not valid:
                self.failures[address] = (attempts + 1, deadline)
                return None, 401
            self.failures.pop(address, None)
            self.sessions = {key: expiry for key, expiry in self.sessions.items() if expiry > now}
            token = secrets.token_urlsafe(32)
            self.sessions[token] = now + 8 * 3600
            return token, 200

    def authenticated(self, cookie):
        try:
            parsed = SimpleCookie(cookie)
            token = parsed[COOKIE].value if COOKIE in parsed else ""
        except Exception:
            return False
        with self.lock:
            return self.sessions.get(token, 0) > time.time()

    def logout(self, cookie):
        try:
            parsed = SimpleCookie(cookie)
            token = parsed[COOKIE].value if COOKIE in parsed else ""
        except Exception:
            return
        with self.lock:
            self.sessions.pop(token, None)

    def service_authorized(self, token, address):
        return address in {"127.0.0.1", "::1"} and bool(self.service_token) and hmac.compare_digest(token, self.service_token)


def same_origin(headers):
    origin = headers.get("Origin")
    if headers.get("Sec-Fetch-Site") == "cross-site":
        return False
    return not origin or urlsplit(origin).netloc == headers.get("Host", "")


def course_route(path):
    return path == "/api/course-mapper/install" or path.startswith((
        "/api/v1/course-production/", "/api/v1/course-import/", "/api/v1/course-library/",
    ))
