from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import logging
import mimetypes
import os
import re
import secrets
import sys
import uuid
from contextlib import closing
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import mysql.connector
from mysql.connector import Error as MySQLError


ROOT = Path(__file__).resolve().parent.parent
UPLOADS = ROOT / "uploads"
SESSION_COOKIE = "spicevilla_session"
SESSION_DAYS = 30
MAX_REQUEST_BYTES = 4 * 1024 * 1024
MAX_IMAGE_BYTES = 2 * 1024 * 1024
GST_RATE = Decimal("0.025")
MONEY = Decimal("0.01")
ORDER_STATUSES = {"New", "Accepted", "Preparing", "Ready", "Completed", "Cancelled"}
PAYMENT_METHODS = {"Cash", "UPI", "Card", "Online Payment"}
ORDER_TYPES = {"Dine-in", "Takeaway", "Delivery"}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class APIError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def connect_db():
    load_backend_environment()
    return mysql.connector.connect(
        host="0.0.0.0"
        port=int(os.environ.get("PORT","10000")),
        user=os.environ.get("MYSQL_USER", "spicevilla"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=os.environ.get("MYSQL_DATABASE", "spicevilla"),
        charset="utf8mb4",
        collation="utf8mb4_0900_ai_ci",
        autocommit=False,
        connection_timeout=5,
    )


def load_backend_environment():
    env_file = Path(__file__).resolve().parent / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        setting = line.strip()
        if not setting or setting.startswith("#") or "=" not in setting:
            continue
        name, value = setting.split("=", 1)
        name, value = name.strip(), value.strip().strip("\"'")
        if name and name not in os.environ:
            os.environ[name] = value


def round_money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def decimal_value(value, field: str, minimum: Decimal = Decimal("0")) -> Decimal:
    try:
        amount = Decimal(str(value)).quantize(MONEY, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        raise APIError(400, f"{field} must be a valid amount.")
    if not amount.is_finite() or amount < minimum:
        raise APIError(400, f"{field} must be at least {minimum}.")
    return amount


def json_value(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8")
    raise TypeError(f"Cannot encode {type(value).__name__} as JSON.")


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    rounds = 310_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)
    return "pbkdf2_sha256${}${}${}".format(
        rounds,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, rounds, salt, expected = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            base64.urlsafe_b64decode(salt.encode("ascii")),
            int(rounds),
        )
        return hmac.compare_digest(actual, base64.urlsafe_b64decode(expected.encode("ascii")))
    except (ValueError, TypeError):
        return False


def normalized_email(value) -> str:
    email = str(value or "").strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise APIError(400, "Enter a valid email address.")
    return email


def require_text(value, field: str, maximum: int, required: bool = True) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise APIError(400, f"{field} is required.")
    if len(text) > maximum:
        raise APIError(400, f"{field} must be {maximum} characters or fewer.")
    return text


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "phone": user.get("phone"),
    }


class SpiceVillaHandler(BaseHTTPRequestHandler):
    server_version = "SpiceVilla/1.0"

    def log_message(self, fmt, *args):
        logging.info("%s - %s", self.address_string(), fmt % args)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.handle_api()
        else:
            self.serve_static()

    def do_POST(self):
        self.handle_api()

    def do_PUT(self):
        self.handle_api()

    def do_PATCH(self):
        self.handle_api()

    def do_DELETE(self):
        self.handle_api()

    def send_json(self, status: int, payload: dict, headers: dict | None = None):
        body = json.dumps(payload, ensure_ascii=False, default=json_value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        if not self.headers.get("Content-Type", "").lower().startswith("application/json"):
            raise APIError(415, "Content-Type must be application/json.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise APIError(400, "Invalid Content-Length.")
        if length < 0 or length > MAX_REQUEST_BYTES:
            raise APIError(413, "Request is too large.")
        if length == 0:
            return {}
        try:
            value = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise APIError(400, "Request body must be valid JSON.")
        if not isinstance(value, dict):
            raise APIError(400, "Request body must be a JSON object.")
        return value

    def request_user(self, connection, required: bool = True, role: str | None = None):
        cookie = SimpleCookie()
        cookie.load(self.headers.get("Cookie", ""))
        morsel = cookie.get(SESSION_COOKIE)
        if not morsel:
            if required:
                raise APIError(401, "Please sign in to continue.")
            return None
        token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                """SELECT u.id, u.email, u.name, u.role, c.phone
                   FROM sessions s JOIN users u ON u.id = s.user_id
                   LEFT JOIN customers c ON c.user_id = u.id
                   WHERE s.token_hash = %s AND s.expires_at > UTC_TIMESTAMP()""",
                (token_hash,),
            )
            user = cursor.fetchone()
        if not user:
            if required:
                raise APIError(401, "Your session expired. Please sign in again.")
            return None
        if role and user["role"] != role:
            raise APIError(403, "You do not have permission to perform this action.")
        return user

    def create_session(self, connection, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()")
            cursor.execute(
                "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (%s, %s, %s)",
                (user_id, token_hash, datetime.utcnow() + timedelta(days=SESSION_DAYS)),
            )
        return token

    def session_cookie(self, token: str, max_age: int = SESSION_DAYS * 86400) -> str:
        secure = "; Secure" if os.environ.get("COOKIE_SECURE") == "1" else ""
        return f"{SESSION_COOKIE}={token}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}"

    def ensure_same_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return
        parsed = urlsplit(origin)
        if parsed.netloc.lower() != self.headers.get("Host", "").lower():
            raise APIError(403, "Cross-origin requests are not allowed.")

    def handle_api(self):
        try:
            if self.command in {"POST", "PUT", "PATCH", "DELETE"}:
                self.ensure_same_origin()
            status, result, headers = self.dispatch_api()
            self.send_json(status, result, headers)
        except APIError as error:
            self.send_json(error.status, {"error": error.message})
        except mysql.connector.IntegrityError:
            self.send_json(409, {"error": "This record conflicts with existing data. Refresh and try again."})
        except MySQLError as error:
            logging.exception("MySQL operation failed")
            self.send_json(503, {"error": "The database is unavailable. Check the MySQL service and backend configuration."})
        except (OSError, ValueError) as error:
            logging.exception("Request could not be completed")
            self.send_json(500, {"error": "The request could not be completed. Check the server log."})

    def dispatch_api(self):
        parsed = urlsplit(self.path)
        segments = [unquote(segment) for segment in parsed.path.strip("/").split("/") if segment]
        query = parse_qs(parsed.query)
        body = self.read_json() if self.command in {"POST", "PUT", "PATCH"} else {}
        if segments == ["api", "config"] and self.command == "GET":
            return 200, {"google_client_id": os.environ.get("GOOGLE_CLIENT_ID", "")}, {}
        if segments == ["api", "health"] and self.command == "GET":
            with closing(connect_db()) as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.fetchone()
            return 200, {"ok": True}, {}

        with closing(connect_db()) as connection:
            if segments == ["api", "auth", "owner-setup"] and self.command == "GET":
                available = self.is_loopback_client() and self.owner_setup_available(connection)
                return 200, {"available": available}, {}
            if segments == ["api", "auth", "register-owner"] and self.command == "POST":
                return self.register_owner(connection, body)
            if segments == ["api", "auth", "register"] and self.command == "POST":
                return self.register(connection, body)
            if segments == ["api", "auth", "login"] and self.command == "POST":
                return self.login(connection, body)
            if segments == ["api", "auth", "google"] and self.command == "POST":
                return self.google_login(connection, body)
            if segments == ["api", "auth", "logout"] and self.command == "POST":
                return self.logout(connection)
            if segments == ["api", "me"] and self.command == "GET":
                user = self.request_user(connection)
                return 200, {"user": public_user(user)}, {}
            if segments == ["api", "profile"]:
                return self.profile(connection, body)
            if segments == ["api", "categories"]:
                return self.categories(connection, body)
            if len(segments) == 3 and segments[:2] == ["api", "categories"]:
                return self.category_detail(connection, segments[2], body)
            if segments == ["api", "foods"]:
                return self.foods(connection, query, body)
            if len(segments) == 4 and segments[:2] == ["api", "bills"] and segments[3] == "payments" and self.command == "POST":
                return self.bill_payment_route(connection, segments[2], body)
            if len(segments) == 3 and segments[:2] == ["api", "foods"]:
                return self.food_detail(connection, segments[2], body)
            if segments == ["api", "orders"]:
                return self.orders(connection, query, body)
            if len(segments) == 3 and segments[:2] == ["api", "orders"]:
                return self.order_detail(connection, segments[2], body)
            if segments == ["api", "bills"]:
                return self.bills(connection, body)
            if len(segments) == 3 and segments[:2] == ["api", "bills"]:
                return self.bill_detail(connection, segments[2], body)
            if segments == ["api", "payments"]:
                return self.payments(connection)
            if len(segments) == 3 and segments[:2] == ["api", "payments"]:
                return self.payment_detail(connection, segments[2], body)
            if segments == ["api", "reports"]:
                return self.reports(connection, query)
            if segments == ["api", "dashboard"]:
                return self.dashboard(connection)
            if segments == ["api", "customers"]:
                return self.customers(connection, None)
            if len(segments) == 3 and segments[:2] == ["api", "customers"]:
                return self.customers(connection, segments[2])
            if segments == ["api", "reservations"]:
                return self.reservations(connection, body)
        raise APIError(404, "API route not found.")

    def register(self, connection, body: dict):
        name = require_text(body.get("name"), "Name", 120)
        email = normalized_email(body.get("email"))
        password = require_text(body.get("password"), "Password", 200)
        if len(password) < 10:
            raise APIError(400, "Password must contain at least 10 characters.")
        phone = require_text(body.get("phone"), "Phone", 32, required=False)
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO users (email, name, password_hash, role) VALUES (%s, %s, %s, 'customer')",
                (email, name, password_hash(password)),
            )
            user_id = cursor.lastrowid
            cursor.execute("INSERT INTO customers (user_id, phone) VALUES (%s, %s)", (user_id, phone or None))
        token = self.create_session(connection, user_id)
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT id, email, name, role FROM users WHERE id = %s", (user_id,))
            user = cursor.fetchone()
        connection.commit()
        return 201, {"user": public_user(user)}, {"Set-Cookie": self.session_cookie(token)}

    def is_loopback_client(self) -> bool:
        try:
            return ipaddress.ip_address(self.client_address[0]).is_loopback
        except (ValueError, IndexError):
            return False

    def owner_setup_available(self, connection) -> bool:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1")
            return cursor.fetchone() is None

    def register_owner(self, connection, body: dict):
        if not self.is_loopback_client():
            raise APIError(403, "Initial owner setup is available only from the restaurant computer.")

        name = require_text(body.get("name"), "Name", 120)
        email = normalized_email(body.get("email"))
        password = require_text(body.get("password"), "Password", 128)
        if len(password) < 10:
            raise APIError(400, "Password must contain at least 10 characters.")

        lock_name = "spicevilla_initial_owner_setup"
        with connection.cursor() as cursor:
            cursor.execute("SELECT GET_LOCK(%s, 5)", (lock_name,))
            lock_result = cursor.fetchone()
            lock_acquired = bool(lock_result and lock_result[0] == 1)
        if not lock_acquired:
            raise APIError(503, "Owner setup is busy. Please try again.")

        try:
            if not self.owner_setup_available(connection):
                raise APIError(409, "Initial owner setup is complete. Ask the administrator to create another owner account.")
            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO users (email, name, password_hash, role) VALUES (%s, %s, %s, 'owner')",
                    (email, name, password_hash(password)),
                )
                user_id = cursor.lastrowid
            token = self.create_session(connection, user_id)
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute("SELECT id, email, name, role FROM users WHERE id = %s", (user_id,))
                user = cursor.fetchone()
            connection.commit()
            return 201, {"user": public_user(user)}, {"Set-Cookie": self.session_cookie(token)}
        finally:
            with connection.cursor() as cursor:
                cursor.execute("SELECT RELEASE_LOCK(%s)", (lock_name,))
                cursor.fetchone()

    def login(self, connection, body: dict):
        email = normalized_email(body.get("email"))
        password = require_text(body.get("password"), "Password", 200)
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT id, email, name, role, password_hash FROM users WHERE email = %s", (email,))
            user = cursor.fetchone()
        if not user or not verify_password(password, user["password_hash"]):
            raise APIError(401, "Email or password is incorrect.")
        token = self.create_session(connection, user["id"])
        connection.commit()
        return 200, {"user": public_user(user)}, {"Set-Cookie": self.session_cookie(token)}

    def google_login(self, connection, body: dict):
        client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
        credential = require_text(body.get("credential"), "Google credential", 10000)
        if not client_id:
            raise APIError(503, "Google sign-in is not configured on this server.")
        try:
            from google.auth.exceptions import TransportError
            from google.auth.transport import requests
            from google.oauth2 import id_token
        except ImportError:
            logging.exception("Google sign-in dependencies are unavailable")
            raise APIError(503, "Google sign-in dependencies are not installed on this server.")
        try:
            claims = id_token.verify_oauth2_token(credential, requests.Request(), client_id)
        except ValueError as error:
            logging.info("Google credential verification failed: %s", error)
            raise APIError(401, "Google sign-in could not be verified.")
        except TransportError:
            logging.exception("Google token verification service could not be reached")
            raise APIError(503, "Google could not verify the sign-in right now. Try again shortly.")
        email = normalized_email(claims.get("email"))
        if claims.get("email_verified") is not True:
            raise APIError(401, "Google email address is not verified.")
        name = require_text(claims.get("name") or email, "Google profile name", 120)
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT id, email, name, role FROM users WHERE email = %s", (email,))
            user = cursor.fetchone()
            if user and user["role"] != "customer":
                raise APIError(403, "Use owner credentials to access the owner portal.")
            if not user:
                cursor.execute(
                    "INSERT INTO users (email, name, password_hash, role) VALUES (%s, %s, %s, 'customer')",
                    (email, name, "!google-only"),
                )
                user_id = cursor.lastrowid
                cursor.execute("INSERT INTO customers (user_id) VALUES (%s)", (user_id,))
                user = {"id": user_id, "email": email, "name": name, "role": "customer"}
        token = self.create_session(connection, user["id"])
        connection.commit()
        return 200, {"user": public_user(user)}, {"Set-Cookie": self.session_cookie(token)}

    def logout(self, connection):
        cookie = SimpleCookie()
        cookie.load(self.headers.get("Cookie", ""))
        morsel = cookie.get(SESSION_COOKIE)
        if morsel:
            token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM sessions WHERE token_hash = %s", (token_hash,))
            connection.commit()
        return 200, {"ok": True}, {"Set-Cookie": self.session_cookie("", 0)}

    def profile(self, connection, body: dict):
        user = self.request_user(connection)
        if self.command == "GET":
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute(
                    """SELECT u.id, u.email, u.name, u.role, c.phone, c.address
                       FROM users u LEFT JOIN customers c ON c.user_id = u.id WHERE u.id = %s""",
                    (user["id"],),
                )
                return 200, {"user": cursor.fetchone()}, {}
        if self.command == "PATCH":
            if user["role"] != "customer":
                raise APIError(403, "Only customers can edit this profile.")
            name = require_text(body.get("name", user["name"]), "Name", 120)
            phone = require_text(body.get("phone", user.get("phone")), "Phone", 32, required=False)
            address = require_text(body.get("address"), "Address", 1000, required=False)
            with connection.cursor() as cursor:
                cursor.execute("UPDATE users SET name = %s WHERE id = %s", (name, user["id"]))
                cursor.execute(
                    "UPDATE customers SET phone = %s, address = %s WHERE user_id = %s",
                    (phone or None, address or None, user["id"]),
                )
            connection.commit()
            return 200, {"user": {"id": user["id"], "name": name, "email": user["email"], "role": user["role"], "phone": phone, "address": address}}, {}
        raise APIError(405, "Method not allowed.")

    def categories(self, connection, body: dict):
        if self.command == "GET":
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute("SELECT id, name, slug FROM food_categories ORDER BY name")
                return 200, {"categories": cursor.fetchall()}, {}
        self.request_user(connection, role="owner")
        if self.command == "POST":
            name = require_text(body.get("name"), "Category name", 80)
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            if not slug:
                raise APIError(400, "Category name must include letters or numbers.")
            with connection.cursor() as cursor:
                cursor.execute("INSERT INTO food_categories (name, slug) VALUES (%s, %s)", (name, slug))
                category_id = cursor.lastrowid
            connection.commit()
            return 201, {"category": {"id": category_id, "name": name, "slug": slug}}, {}
        raise APIError(405, "Method not allowed.")

    def category_detail(self, connection, raw_id: str, body: dict):
        self.request_user(connection, role="owner")
        category_id = self.positive_id(raw_id, "Category")
        if self.command in {"PUT", "PATCH"}:
            name = require_text(body.get("name"), "Category name", 80)
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            if not slug:
                raise APIError(400, "Category name must include letters or numbers.")
            with connection.cursor() as cursor:
                cursor.execute("UPDATE food_categories SET name = %s, slug = %s WHERE id = %s", (name, slug, category_id))
                if cursor.rowcount == 0:
                    cursor.execute("SELECT id FROM food_categories WHERE id = %s", (category_id,))
                    if not cursor.fetchone():
                        raise APIError(404, "Food category not found.")
            connection.commit()
            return 200, {"ok": True}, {}
        if self.command == "DELETE":
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM food_categories WHERE id = %s", (category_id,))
                if cursor.rowcount == 0:
                    raise APIError(404, "Food category not found.")
            connection.commit()
            return 200, {"ok": True}, {}
        raise APIError(405, "Method not allowed.")

    def bill_payment_route(self, connection, raw_id: str, body: dict):
        bill_id = self.positive_id(raw_id, "Bill")
        user = self.request_user(connection)
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                """SELECT b.*, o.user_id, o.order_number, o.customer_name
                   FROM bills b JOIN orders o ON o.id = b.order_id WHERE b.id = %s""",
                (bill_id,),
            )
            bill = cursor.fetchone()
        if not bill or (user["role"] != "owner" and bill["user_id"] != user["id"]):
            raise APIError(404, "Invoice not found.")
        return self.create_payment(connection, bill, body, user)

    def foods(self, connection, query: dict, body: dict):
        if self.command == "GET":
            user = self.request_user(connection, required=False)
            include_unavailable = bool(query.get("includeUnavailable") == ["1"] and user and user["role"] == "owner")
            category = query.get("category", [""])[0]
            search = query.get("search", [""])[0].strip()
            sql = """SELECT f.id, f.category_id, c.name AS category, f.name, f.description,
                            f.price, f.image_url, f.is_available
                     FROM food_items f JOIN food_categories c ON c.id = f.category_id"""
            clauses, values = [], []
            if not include_unavailable:
                clauses.append("f.is_available = TRUE")
            if category:
                clauses.append("(c.slug = %s OR c.name = %s)")
                values.extend((category, category))
            if search:
                clauses.append("(f.name LIKE %s OR f.description LIKE %s)")
                values.extend((f"%{search}%", f"%{search}%"))
            if clauses:
                sql += " WHERE " + " AND ".join(clauses)
            sql += " ORDER BY c.name, f.name"
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute(sql, tuple(values))
                items = cursor.fetchall()
            return 200, {"items": items}, {}
        self.request_user(connection, role="owner")
        if self.command != "POST":
            raise APIError(405, "Method not allowed.")
        category_id = self.positive_id(body.get("category_id"), "Category")
        name = require_text(body.get("name"), "Food name", 120)
        description = require_text(body.get("description"), "Description", 2000, required=False)
        price = decimal_value(body.get("price"), "Price")
        available = body.get("is_available", True)
        if not isinstance(available, bool):
            raise APIError(400, "Availability must be true or false.")
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT id FROM food_categories WHERE id = %s", (category_id,))
            if not cursor.fetchone():
                raise APIError(400, "Choose an existing food category.")
            image_url = self.save_image(body.get("image")) if body.get("image") else self.valid_image_url(body.get("image_url"))
            cursor.execute(
                """INSERT INTO food_items (category_id, name, description, price, image_url, is_available)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (category_id, name, description, price, image_url, available),
            )
            item_id = cursor.lastrowid
        connection.commit()
        return 201, {"item": {"id": item_id, "category_id": category_id, "name": name, "description": description, "price": price, "image_url": image_url, "is_available": available}}, {}

    def valid_image_url(self, value):
        image_url = require_text(value, "Image URL", 500, required=False)
        if not image_url:
            return None
        try:
            parsed = urlsplit(image_url)
        except ValueError:
            raise APIError(400, "Image URL must be a valid HTTPS URL or an uploaded SpiceVilla image.")
        is_upload = bool(re.fullmatch(r"/uploads/[A-Za-z0-9_-]+\.(?:jpg|png|webp)", image_url))
        if not is_upload and (parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password):
            raise APIError(400, "Image URL must be an HTTPS URL or an uploaded SpiceVilla image.")
        return image_url

    def food_detail(self, connection, raw_id: str, body: dict):
        item_id = self.positive_id(raw_id, "Food item")
        if self.command == "GET":
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute(
                    """SELECT f.id, f.category_id, c.name AS category, f.name, f.description,
                              f.price, f.image_url, f.is_available
                       FROM food_items f JOIN food_categories c ON c.id = f.category_id
                       WHERE f.id = %s""",
                    (item_id,),
                )
                item = cursor.fetchone()
            if not item:
                raise APIError(404, "Food item not found.")
            return 200, {"item": item}, {}
        self.request_user(connection, role="owner")
        if self.command in {"PUT", "PATCH"}:
            allowed = {"category_id", "name", "description", "price", "is_available", "image_url", "image"}
            if set(body) - allowed:
                raise APIError(400, "Food item contains unsupported fields.")
            fields, values = [], []
            if "category_id" in body:
                category_id = self.positive_id(body["category_id"], "Category")
                fields.append("category_id = %s")
                values.append(category_id)
            if "name" in body:
                fields.append("name = %s")
                values.append(require_text(body["name"], "Food name", 120))
            if "description" in body:
                fields.append("description = %s")
                values.append(require_text(body["description"], "Description", 2000, required=False))
            if "price" in body:
                fields.append("price = %s")
                values.append(decimal_value(body["price"], "Price"))
            if "is_available" in body:
                if not isinstance(body["is_available"], bool):
                    raise APIError(400, "Availability must be true or false.")
                fields.append("is_available = %s")
                values.append(body["is_available"])
            if "image" in body:
                fields.append("image_url = %s")
                values.append(self.save_image(body["image"]))
            elif "image_url" in body:
                fields.append("image_url = %s")
                values.append(self.valid_image_url(body["image_url"]))
            if not fields:
                raise APIError(400, "Provide at least one field to update.")
            values.append(item_id)
            with connection.cursor() as cursor:
                cursor.execute(f"UPDATE food_items SET {', '.join(fields)} WHERE id = %s", tuple(values))
                if cursor.rowcount == 0:
                    cursor.execute("SELECT id FROM food_items WHERE id = %s", (item_id,))
                    if not cursor.fetchone():
                        raise APIError(404, "Food item not found.")
            connection.commit()
            return 200, {"ok": True}, {}
        if self.command == "DELETE":
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM food_items WHERE id = %s", (item_id,))
                if cursor.rowcount == 0:
                    raise APIError(404, "Food item not found.")
            connection.commit()
            return 200, {"ok": True}, {}
        raise APIError(405, "Method not allowed.")

    def save_image(self, value):
        if not value:
            return None
        match = re.fullmatch(r"data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)", str(value))
        if not match:
            raise APIError(400, "Food images must be PNG, JPEG, or WebP data URLs.")
        media_type, encoded = match.groups()
        if len(encoded) > MAX_IMAGE_BYTES * 2:
            raise APIError(413, "Food image must be 2 MB or smaller.")
        try:
            data = base64.b64decode(encoded, validate=True)
        except ValueError:
            raise APIError(400, "Food image data is invalid.")
        if not data or len(data) > MAX_IMAGE_BYTES:
            raise APIError(413, "Food image must be between 1 byte and 2 MB.")
        extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[media_type]
        UPLOADS.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid.uuid4().hex}{extension}"
        (UPLOADS / filename).write_bytes(data)
        return f"/uploads/{filename}"

    def positive_id(self, value, field: str) -> int:
        try:
            number = int(value)
        except (ValueError, TypeError):
            raise APIError(400, f"{field} ID is invalid.")
        if number <= 0:
            raise APIError(400, f"{field} ID is invalid.")
        return number

    def order_items(self, connection, order_id: int):
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                """SELECT id, food_id, food_name AS name, quantity AS qty, unit_price AS price, line_total
                   FROM order_items WHERE order_id = %s ORDER BY id""",
                (order_id,),
            )
            return cursor.fetchall()

    def orders(self, connection, query: dict, body: dict):
        if self.command == "GET":
            user = self.request_user(connection)
            clauses, values = [], []
            if user["role"] != "owner":
                clauses.append("o.user_id = %s")
                values.append(user["id"])
            status = query.get("status", [""])[0]
            if status:
                if status not in ORDER_STATUSES:
                    raise APIError(400, "Unknown order status.")
                clauses.append("o.status = %s")
                values.append(status)
            sql = """SELECT o.id, o.order_number, o.user_id, o.customer_name, o.customer_email,
                            o.customer_phone, o.order_type, o.table_label, o.status, o.payment_method,
                            o.subtotal, o.discount_amount, o.cgst, o.sgst, o.total, o.notes, o.created_at
                     FROM orders o"""
            if clauses:
                sql += " WHERE " + " AND ".join(clauses)
            sql += " ORDER BY o.created_at DESC LIMIT 500"
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute(sql, tuple(values))
                items = cursor.fetchall()
            for order in items:
                order["items"] = self.order_items(connection, order["id"])
            return 200, {"orders": items}, {}

        user = self.request_user(connection)
        if self.command != "POST":
            raise APIError(405, "Method not allowed.")
        raw_items = body.get("items")
        if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 100:
            raise APIError(400, "Add between 1 and 100 food items.")
        quantities = {}
        for line in raw_items:
            if not isinstance(line, dict):
                raise APIError(400, "Each order item must be an object.")
            food_id = self.positive_id(line.get("food_id"), "Food item")
            try:
                quantity = int(line.get("quantity"))
            except (TypeError, ValueError):
                raise APIError(400, "Item quantity must be a whole number.")
            if quantity < 1 or quantity > 99:
                raise APIError(400, "Item quantity must be between 1 and 99.")
            quantities[food_id] = quantities.get(food_id, 0) + quantity
        idempotency_key = require_text(body.get("idempotency_key"), "Order request key", 64)
        if not re.fullmatch(r"[A-Za-z0-9_-]+", idempotency_key):
            raise APIError(400, "Order request key contains unsupported characters.")
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT id, user_id FROM orders WHERE idempotency_key = %s", (idempotency_key,))
            existing = cursor.fetchone()
            if existing:
                if user["role"] != "owner" and existing["user_id"] != user["id"]:
                    raise APIError(409, "This request key has already been used.")
                return 200, {"order": self.order_response(connection, existing["id"]), "duplicate": True}, {}

        placeholders = ", ".join(["%s"] * len(quantities))
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                f"""SELECT id, name, price FROM food_items
                    WHERE is_available = TRUE AND id IN ({placeholders})""",
                tuple(quantities.keys()),
            )
            foods = {item["id"]: item for item in cursor.fetchall()}
        if len(foods) != len(quantities):
            raise APIError(400, "One or more selected dishes are unavailable. Refresh the menu and try again.")

        customer_name = require_text(body.get("customer_name", user["name"]), "Customer name", 120)
        customer_phone = require_text(body.get("customer_phone", user.get("phone")), "Phone", 32, required=False)
        order_type = body.get("order_type", "Takeaway")
        if order_type not in ORDER_TYPES:
            raise APIError(400, "Choose a valid order type.")
        payment_method = body.get("payment_method", "Pay at restaurant")
        if payment_method not in PAYMENT_METHODS | {"Pay at restaurant"}:
            raise APIError(400, "Choose a valid payment method.")
        table_label = require_text(body.get("table_label"), "Table", 40, required=False)
        notes = require_text(body.get("notes"), "Order notes", 1000, required=False)
        lines, subtotal = [], Decimal("0.00")
        for food_id, quantity in quantities.items():
            food = foods[food_id]
            unit_price = Decimal(food["price"])
            line_total = round_money(unit_price * quantity)
            subtotal += line_total
            lines.append((food_id, food["name"], quantity, unit_price, line_total))
        subtotal = round_money(subtotal)
        cgst, sgst = round_money(subtotal * GST_RATE), round_money(subtotal * GST_RATE)
        total = round_money(subtotal + cgst + sgst)
        order_number = f"SV-{uuid.uuid4().hex[:12].upper()}"
        with connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO orders
                   (order_number, idempotency_key, user_id, customer_name, customer_email, customer_phone,
                    order_type, table_label, payment_method, subtotal, cgst, sgst, total, notes)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (order_number, idempotency_key, user["id"] if user["role"] == "customer" else None,
                 customer_name, user["email"] if user["role"] == "customer" else None,
                 customer_phone or None, order_type, table_label or None, payment_method,
                 subtotal, cgst, sgst, total, notes or None),
            )
            order_id = cursor.lastrowid
            cursor.executemany(
                """INSERT INTO order_items (order_id, food_id, food_name, quantity, unit_price, line_total)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                [(order_id, *line) for line in lines],
            )
        connection.commit()
        return 201, {"order": self.order_response(connection, order_id), "duplicate": False}, {}

    def order_response(self, connection, order_id: int):
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT * FROM orders WHERE id = %s", (order_id,))
            order = cursor.fetchone()
        if not order:
            raise APIError(404, "Order not found.")
        order["items"] = self.order_items(connection, order_id)
        return order

    def order_detail(self, connection, raw_id: str, body: dict):
        order_id = self.positive_id(raw_id, "Order")
        user = self.request_user(connection)
        if self.command not in {"GET", "PATCH"}:
            raise APIError(405, "Method not allowed.")
        if self.command == "PATCH":
            with connection.cursor() as cursor:
                cursor.execute("SELECT id FROM orders WHERE id = %s FOR UPDATE", (order_id,))
                if not cursor.fetchone():
                    raise APIError(404, "Order not found.")
        order = self.order_response(connection, order_id)
        if user["role"] != "owner" and order["user_id"] != user["id"]:
            raise APIError(404, "Order not found.")
        if self.command == "GET":
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute("SELECT * FROM bills WHERE order_id = %s", (order_id,))
                order["bill"] = cursor.fetchone()
            return 200, {"order": order}, {}
        new_status = body.get("status")
        current = order["status"]
        allowed = {
            "New": {"Accepted", "Cancelled"},
            "Accepted": {"Preparing", "Cancelled"},
            "Preparing": {"Ready", "Cancelled"},
            "Ready": {"Completed"},
            "Completed": set(),
            "Cancelled": set(),
        }
        if user["role"] != "owner" and not (new_status == "Cancelled" and current == "New"):
            raise APIError(403, "Only the owner can update this order.")
        if new_status not in allowed.get(current, set()):
            raise APIError(409, f"Order cannot move from {current} to {new_status}.")
        with connection.cursor() as cursor:
            cursor.execute("UPDATE orders SET status = %s WHERE id = %s", (new_status, order_id))
        connection.commit()
        return 200, {"order": self.order_response(connection, order_id)}, {}

    def bills(self, connection, body: dict):
        if self.command == "GET":
            user = self.request_user(connection)
            customer_clause = "" if user["role"] == "owner" else "WHERE o.user_id = %s"
            parameters = () if user["role"] == "owner" else (user["id"],)
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute(
                    f"""SELECT b.*, o.order_number, o.customer_name, o.customer_email, o.order_type,
                               o.payment_method, o.status AS order_status,
                               COALESCE((SELECT SUM(p.amount) FROM payments p
                                         WHERE p.bill_id = b.id AND p.status = 'completed'), 0) AS paid_amount
                        FROM bills b JOIN orders o ON o.id = b.order_id
                        {customer_clause}
                        ORDER BY b.issued_at DESC LIMIT 500""",
                    parameters,
                )
                rows = cursor.fetchall()
            return 200, {"bills": rows}, {}
        user = self.request_user(connection, role="owner")
        order_id = self.positive_id(body.get("order_id"), "Order")
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT * FROM orders WHERE id = %s FOR UPDATE", (order_id,))
            order = cursor.fetchone()
        if not order:
            raise APIError(404, "Order not found.")
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT * FROM bills WHERE order_id = %s", (order_id,))
            existing = cursor.fetchone()
        if existing:
            connection.commit()
            return 200, {"bill": existing, "duplicate": True}, {}
        discount_type = body.get("discount_type", "amount")
        discount_input = decimal_value(body.get("discount", 0), "Discount")
        subtotal = Decimal(order["subtotal"])
        if discount_type == "percent":
            if discount_input > 100:
                raise APIError(400, "Discount percentage cannot exceed 100%.")
            discount = round_money(subtotal * discount_input / Decimal("100"))
        elif discount_type == "amount":
            discount = discount_input
        else:
            raise APIError(400, "Discount type must be amount or percent.")
        if discount > subtotal:
            raise APIError(400, "Discount cannot exceed the order subtotal.")
        taxable = round_money(subtotal - discount)
        cgst, sgst = round_money(taxable * GST_RATE), round_money(taxable * GST_RATE)
        total = round_money(taxable + cgst + sgst)
        invoice_number = f"SV-INV-{uuid.uuid4().hex[:12].upper()}"
        with connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO bills
                   (invoice_number, order_id, subtotal, discount_amount, cgst_rate, sgst_rate, cgst, sgst, total)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (invoice_number, order_id, subtotal, discount, Decimal("2.50"), Decimal("2.50"), cgst, sgst, total),
            )
            bill_id = cursor.lastrowid
            cursor.execute(
                """UPDATE orders SET discount_amount = %s, cgst = %s, sgst = %s, total = %s
                   WHERE id = %s""",
                (discount, cgst, sgst, total, order_id),
            )
        connection.commit()
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT * FROM bills WHERE id = %s", (bill_id,))
            bill = cursor.fetchone()
        return 201, {"bill": bill, "duplicate": False}, {}

    def bill_detail(self, connection, raw_id: str, body: dict):
        bill_id = self.positive_id(raw_id, "Bill")
        user = self.request_user(connection)
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                """SELECT b.*, o.order_number, o.user_id, o.customer_name, o.customer_email,
                          o.customer_phone, o.order_type, o.payment_method
                   FROM bills b JOIN orders o ON o.id = b.order_id WHERE b.id = %s""",
                (bill_id,),
            )
            bill = cursor.fetchone()
        if not bill or (user["role"] != "owner" and bill["user_id"] != user["id"]):
            raise APIError(404, "Invoice not found.")
        if self.command == "GET":
            bill["items"] = self.order_items(connection, bill["order_id"])
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute("SELECT * FROM payments WHERE bill_id = %s ORDER BY created_at DESC", (bill_id,))
                bill["payments"] = cursor.fetchall()
            return 200, {"bill": bill}, {}
        if self.command != "POST" or self.path.split("?", 1)[0].endswith("/payments") is False:
            raise APIError(405, "Method not allowed.")
        return self.create_payment(connection, bill, body, user)

    def create_payment(self, connection, bill: dict, body: dict, user: dict):
        method = body.get("method")
        if method not in PAYMENT_METHODS:
            raise APIError(400, "Choose Cash, UPI, Card, or Online Payment.")
        amount = decimal_value(body.get("amount", bill["total"]), "Payment", Decimal("0.01"))
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT total FROM bills WHERE id = %s FOR UPDATE", (bill["id"],))
            locked_bill = cursor.fetchone()
            if not locked_bill:
                raise APIError(404, "Invoice not found.")
            cursor.execute(
                """SELECT COALESCE(SUM(amount), 0) AS reserved
                   FROM payments WHERE bill_id = %s AND status IN ('pending', 'completed')""",
                (bill["id"],),
            )
            reserved = Decimal(cursor.fetchone()["reserved"])
        if amount > Decimal(locked_bill["total"]) - reserved:
            raise APIError(400, "Payment cannot exceed the invoice balance not already reserved by another payment.")
        reference = require_text(body.get("transaction_reference"), "Transaction reference", 100, required=False)
        with connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO payments (bill_id, method, amount, status, transaction_reference)
                   VALUES (%s, %s, %s, 'pending', %s)""",
                (bill["id"], method, amount, reference or None),
            )
            payment_id = cursor.lastrowid
        connection.commit()
        return 201, {
            "payment": {"id": payment_id, "bill_id": bill["id"], "method": method,
                        "amount": amount, "status": "pending"},
            "message": "Payment record created as pending. The owner must confirm receipt; no payment gateway is connected.",
        }, {}

    def payments(self, connection):
        user = self.request_user(connection)
        clause = "" if user["role"] == "owner" else "AND o.user_id = %s"
        parameters = () if user["role"] == "owner" else (user["id"],)
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                f"""SELECT p.*, b.invoice_number, o.order_number, o.customer_name
                    FROM payments p JOIN bills b ON b.id = p.bill_id
                    JOIN orders o ON o.id = b.order_id
                    WHERE 1=1 {clause} ORDER BY p.created_at DESC LIMIT 500""",
                parameters,
            )
            return 200, {"payments": cursor.fetchall()}, {}

    def payment_detail(self, connection, raw_id: str, body: dict):
        payment_id = self.positive_id(raw_id, "Payment")
        self.request_user(connection, role="owner")
        status = body.get("status")
        if status not in {"completed", "failed", "refunded"}:
            raise APIError(400, "Payment status must be completed, failed, or refunded.")
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT bill_id FROM payments WHERE id = %s", (payment_id,))
            reference = cursor.fetchone()
            if not reference:
                raise APIError(404, "Payment record not found.")
            cursor.execute("SELECT total FROM bills WHERE id = %s FOR UPDATE", (reference["bill_id"],))
            bill = cursor.fetchone()
            cursor.execute("SELECT * FROM payments WHERE id = %s FOR UPDATE", (payment_id,))
            payment = cursor.fetchone()
        if not payment or not bill:
            raise APIError(404, "Payment record not found.")
        allowed_transitions = {
            "pending": {"completed", "failed"},
            "completed": {"refunded"},
            "failed": set(),
            "refunded": set(),
        }
        if status != payment["status"] and status not in allowed_transitions[payment["status"]]:
            raise APIError(409, f"Payment cannot move from {payment['status']} to {status}.")
        if status == "completed" and payment["status"] != "completed":
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute(
                    """SELECT COALESCE(SUM(amount), 0) AS paid FROM payments
                       WHERE bill_id = %s AND status = 'completed' AND id <> %s""",
                    (payment["bill_id"], payment_id),
                )
                paid = Decimal(cursor.fetchone()["paid"])
            if Decimal(payment["amount"]) > Decimal(bill["total"]) - paid:
                raise APIError(409, "Confirming this payment would overpay the invoice.")
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE payments SET status = %s, paid_at = %s WHERE id = %s",
                (
                    status,
                    datetime.utcnow() if status == "completed" else payment["paid_at"] if status == "refunded" else None,
                    payment_id,
                ),
            )
        connection.commit()
        payment["status"] = status
        return 200, {"payment": payment}, {}

    def report_period(self, query: dict):
        period = query.get("period", ["daily"])[0]
        today = date.today()
        if period == "daily":
            start = today
        elif period == "weekly":
            start = today - timedelta(days=today.weekday())
        elif period == "monthly":
            start = today.replace(day=1)
        else:
            raise APIError(400, "Report period must be daily, weekly, or monthly.")
        return period, datetime.combine(start, time.min), datetime.combine(today + timedelta(days=1), time.min)

    def reports(self, connection, query: dict):
        self.request_user(connection, role="owner")
        period, start, end = self.report_period(query)
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                """SELECT COUNT(*) AS order_count,
                          COALESCE(SUM(total), 0) AS gross_revenue,
                          COALESCE(SUM(CASE WHEN status = 'Cancelled' THEN total ELSE 0 END), 0) AS cancelled_value,
                          COALESCE(SUM(CASE WHEN status NOT IN ('Completed', 'Cancelled') THEN 1 ELSE 0 END), 0) AS pending_orders
                   FROM orders WHERE created_at >= %s AND created_at < %s""",
                (start, end),
            )
            summary = cursor.fetchone()
            cursor.execute(
                """SELECT oi.food_name AS name, SUM(oi.quantity) AS quantity,
                          SUM(oi.line_total) AS revenue
                   FROM order_items oi JOIN orders o ON o.id = oi.order_id
                   WHERE o.created_at >= %s AND o.created_at < %s AND o.status <> 'Cancelled'
                   GROUP BY oi.food_name ORDER BY quantity DESC, revenue DESC LIMIT 10""",
                (start, end),
            )
            best_sellers = cursor.fetchall()
            cursor.execute(
                """SELECT DATE(created_at) AS day, COUNT(*) AS order_count, SUM(total) AS revenue
                   FROM orders WHERE created_at >= %s AND created_at < %s AND status <> 'Cancelled'
                   GROUP BY DATE(created_at) ORDER BY day""",
                (start, end),
            )
            series = cursor.fetchall()
            cursor.execute(
                """SELECT p.id, p.method, p.amount, p.status, p.created_at, b.invoice_number, o.order_number
                   FROM payments p JOIN bills b ON b.id = p.bill_id JOIN orders o ON o.id = b.order_id
                   WHERE p.created_at >= %s AND p.created_at < %s
                   ORDER BY p.created_at DESC LIMIT 20""",
                (start, end),
            )
            recent_payments = cursor.fetchall()
        return 200, {
            "period": period,
            "from": start.date(),
            "to": (end - timedelta(days=1)).date(),
            "summary": summary,
            "best_sellers": best_sellers,
            "sales_by_day": series,
            "recent_payments": recent_payments,
        }, {}

    def dashboard(self, connection):
        self.request_user(connection, role="owner")
        start = datetime.combine(date.today(), time.min)
        end = start + timedelta(days=1)
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                """SELECT COALESCE(SUM(total), 0) AS revenue,
                          COUNT(*) AS orders,
                          COALESCE(SUM(status IN ('New', 'Accepted', 'Preparing', 'Ready')), 0) AS pending_orders
                   FROM orders WHERE created_at >= %s AND created_at < %s AND status <> 'Cancelled'""",
                (start, end),
            )
            today = cursor.fetchone()
            cursor.execute(
                """SELECT COUNT(*) AS total_orders,
                          COALESCE(SUM(total), 0) AS total_sales,
                          COALESCE(AVG(total), 0) AS average_order
                   FROM orders WHERE status <> 'Cancelled'"""
            )
            all_time = cursor.fetchone()
            cursor.execute(
                """SELECT oi.food_name AS name, SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS revenue
                   FROM order_items oi JOIN orders o ON o.id = oi.order_id
                   WHERE o.status <> 'Cancelled'
                   GROUP BY oi.food_name ORDER BY quantity DESC LIMIT 5"""
            )
            best_sellers = cursor.fetchall()
            cursor.execute(
                """SELECT o.order_number, o.customer_name, o.total, o.status, o.created_at
                   FROM orders o ORDER BY o.created_at DESC LIMIT 10"""
            )
            recent_orders = cursor.fetchall()
            cursor.execute(
                """SELECT DATE(created_at) AS day, SUM(total) AS revenue
                   FROM orders WHERE created_at >= %s AND created_at < %s AND status <> 'Cancelled'
                   GROUP BY DATE(created_at) ORDER BY day""",
                (start - timedelta(days=6), end),
            )
            sales_by_day = cursor.fetchall()
        return 200, {"today": today, "all_time": all_time, "best_sellers": best_sellers, "recent_orders": recent_orders, "sales_by_day": sales_by_day}, {}

    def customers(self, connection, raw_id: str | None):
        self.request_user(connection, role="owner")
        if self.command != "GET":
            raise APIError(405, "Method not allowed.")
        if raw_id is None:
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute(
                    """SELECT u.id, u.name, u.email, c.phone, c.address, u.created_at,
                              COUNT(DISTINCT o.id) AS order_count,
                              COALESCE(SUM(CASE WHEN o.status <> 'Cancelled' THEN o.total ELSE 0 END), 0) AS lifetime_value
                       FROM users u JOIN customers c ON c.user_id = u.id
                       LEFT JOIN orders o ON o.user_id = u.id
                       GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500"""
                )
                return 200, {"customers": cursor.fetchall()}, {}
        customer_id = self.positive_id(raw_id, "Customer")
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                """SELECT u.id, u.name, u.email, c.phone, c.address, u.created_at
                   FROM users u JOIN customers c ON c.user_id = u.id WHERE u.id = %s""",
                (customer_id,),
            )
            customer = cursor.fetchone()
        if not customer:
            raise APIError(404, "Customer not found.")
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                """SELECT id, order_number, order_type, status, total, created_at
                   FROM orders WHERE user_id = %s ORDER BY created_at DESC LIMIT 100""",
                (customer_id,),
            )
            customer["orders"] = cursor.fetchall()
        return 200, {"customer": customer}, {}

    def reservations(self, connection, body: dict):
        if self.command == "GET":
            self.request_user(connection, role="owner")
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute("SELECT * FROM reservations ORDER BY reservation_at DESC LIMIT 500")
                return 200, {"reservations": cursor.fetchall()}, {}
        if self.command != "POST":
            raise APIError(405, "Method not allowed.")
        name = require_text(body.get("name"), "Name", 120)
        phone = require_text(body.get("phone"), "Phone", 32)
        try:
            guests = int(body.get("guests"))
            reservation_at = datetime.fromisoformat(
                f"{body.get('date')}T{body.get('time')}"
            )
        except (TypeError, ValueError):
            raise APIError(400, "Enter a valid reservation date and time.")
        if guests < 1 or guests > 20 or reservation_at < datetime.now():
            raise APIError(400, "Choose 1–20 guests and a future reservation time.")
        notes = require_text(body.get("notes"), "Notes", 1000, required=False)
        with connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO reservations (customer_name, customer_phone, guest_count, reservation_at, notes)
                   VALUES (%s, %s, %s, %s, %s)""",
                (name, phone, guests, reservation_at, notes or None),
            )
            reservation_id = cursor.lastrowid
        connection.commit()
        return 201, {"reservation": {"id": reservation_id, "name": name, "phone": phone, "guests": guests, "reservation_at": reservation_at}}, {}

    def serve_static(self):
        path_part = unquote(urlsplit(self.path).path)
        if path_part == "/":
            path_part = "/index.html"
        target = (ROOT / path_part.lstrip("/")).resolve()
        try:
            relative = target.relative_to(ROOT)
        except ValueError:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        allowed = relative == Path("index.html") or (
            len(relative.parts) > 1 and relative.parts[0] in {"assets", "pages", "uploads"}
        )
        if not allowed:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type, _ = mimetypes.guess_type(str(target))
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type or 'application/octet-stream'}; charset=utf-8" if content_type and content_type.startswith(("text/", "application/javascript")) else (content_type or "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


def main():
    host = os.environ.get("SPICEVILLA_HOST", "127.0.0.1")
    port = int(os.environ.get("SPICEVILLA_PORT", "8000"))
    try:
        with closing(connect_db()) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
    except MySQLError:
        logging.exception("Could not connect to MySQL; confirm backend/.env or environment variables and import backend/schema.sql.")
        return 1
    server = ThreadingHTTPServer((host, port), SpiceVillaHandler)
    logging.info("SpiceVilla server listening at http://%s:%s", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("Shutting down SpiceVilla server.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
