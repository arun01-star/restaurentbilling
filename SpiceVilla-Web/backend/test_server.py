import os
import unittest
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from server import APIError, SpiceVillaHandler, decimal_value, password_hash, round_money, verify_password


class BillingValidationTests(unittest.TestCase):
    def test_rounding_uses_currency_precision(self):
        self.assertEqual(round_money(Decimal("1.005")), Decimal("1.01"))

    def test_amount_validation_rejects_bad_values(self):
        for value in ("not-a-number", Decimal("-0.01"), Decimal("NaN")):
            with self.subTest(value=value), self.assertRaises(APIError):
                decimal_value(value, "Amount")

    def test_amount_validation_applies_minimum(self):
        with self.assertRaises(APIError):
            decimal_value("0", "Payment", Decimal("0.01"))


class AuthenticationValidationTests(unittest.TestCase):
    def test_password_hash_verifies_only_the_original_password(self):
        encoded = password_hash("example-password-123")
        self.assertTrue(verify_password("example-password-123", encoded))
        self.assertFalse(verify_password("wrong-password", encoded))

    def test_owner_setup_is_available_only_before_first_owner_exists(self):
        handler = SpiceVillaHandler.__new__(SpiceVillaHandler)
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = None
        self.assertTrue(handler.owner_setup_available(connection))
        cursor.fetchone.return_value = (1,)
        self.assertFalse(handler.owner_setup_available(connection))

    def test_owner_registration_rejects_non_local_requests(self):
        handler = SpiceVillaHandler.__new__(SpiceVillaHandler)
        handler.client_address = ("203.0.113.10", 12345)
        with self.assertRaises(APIError) as error:
            handler.register_owner(None, {})
        self.assertEqual(error.exception.status, 403)

    def test_owner_registration_requires_a_strong_password(self):
        handler = SpiceVillaHandler.__new__(SpiceVillaHandler)
        handler.client_address = ("127.0.0.1", 12345)
        with self.assertRaises(APIError) as error:
            handler.register_owner(None, {
                "name": "Restaurant Owner",
                "email": "owner@example.com",
                "password": "short",
            })
        self.assertEqual(error.exception.status, 400)


class ImageUrlValidationTests(unittest.TestCase):
    def setUp(self):
        self.handler = SpiceVillaHandler.__new__(SpiceVillaHandler)

    def test_allows_https_and_uploaded_images(self):
        self.assertEqual(
            self.handler.valid_image_url("https://images.example/menu.jpg?width=300"),
            "https://images.example/menu.jpg?width=300",
        )
        self.assertEqual(self.handler.valid_image_url("/uploads/abc123.webp"), "/uploads/abc123.webp")

    def test_rejects_unsafe_image_urls(self):
        for value in ("javascript:alert(1)", "http://images.example/menu.jpg", "/uploads/../../secret.png"):
            with self.subTest(value=value), self.assertRaises(APIError):
                self.handler.valid_image_url(value)


class ReportPeriodTests(unittest.TestCase):
    def test_monthly_period_covers_month_to_date(self):
        handler = SpiceVillaHandler.__new__(SpiceVillaHandler)
        _, start, end = handler.report_period({"period": ["monthly"]})
        self.assertEqual(start, datetime.combine(date.today().replace(day=1), time.min))
        self.assertEqual(end, datetime.combine(date.today() + timedelta(days=1), time.min))

    def test_unknown_period_is_rejected(self):
        handler = SpiceVillaHandler.__new__(SpiceVillaHandler)
        with self.assertRaises(APIError):
            handler.report_period({"period": ["yearly"]})


class GoogleLoginValidationTests(unittest.TestCase):
    def setUp(self):
        self.handler = SpiceVillaHandler.__new__(SpiceVillaHandler)

    def test_google_login_requires_a_client_id(self):
        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": ""}), self.assertRaises(APIError) as error:
            self.handler.google_login(None, {"credential": "test-token"})
        self.assertEqual(error.exception.status, 503)

    def test_google_login_rejects_an_invalid_token(self):
        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "test-client.apps.googleusercontent.com"}):
            with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=ValueError("invalid token")):
                with self.assertRaises(APIError) as error:
                    self.handler.google_login(None, {"credential": "invalid-token"})
        self.assertEqual(error.exception.status, 401)

    def test_google_login_reports_verification_outage(self):
        from google.auth.exceptions import TransportError

        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "test-client.apps.googleusercontent.com"}):
            with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=TransportError("offline")):
                with self.assertRaises(APIError) as error:
                    self.handler.google_login(None, {"credential": "test-token"})
        self.assertEqual(error.exception.status, 503)


if __name__ == "__main__":
    unittest.main()
