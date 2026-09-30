import json
import unittest
from unittest.mock import patch

from packages.accounts.smtp2go import (
    EmailDeliveryError,
    SMTP2GOConfig,
    SMTP2GOMailer,
    SMTP2GO_SEND_URL,
)


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class SMTP2GOTests(unittest.TestCase):
    def test_configuration_is_optional_but_not_partial(self):
        self.assertIsNone(SMTP2GOConfig.from_values(None, None))
        with self.assertRaisesRegex(ValueError, "configured together"):
            SMTP2GOConfig.from_values("api-key", None)

    @patch("packages.accounts.smtp2go.urlopen")
    def test_invitation_uses_fragment_link_and_server_side_api_key(self, urlopen):
        urlopen.return_value = _Response({
            "request_id": "request-1",
            "data": {"succeeded": 1, "failed": 0, "email_id": "message-1"},
        })
        mailer = SMTP2GOMailer(SMTP2GOConfig(
            "private-api-key", "Jetta <verified@jetta.com>", "https://golfgame.jetta.com"
        ))
        result = mailer.send_coach_invitation(
            "STUDENT@example.com", "Coach <David>", "JINV-token_value"
        )

        request = urlopen.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(request.full_url, SMTP2GO_SEND_URL)
        self.assertEqual(request.headers["X-smtp2go-api-key"], "private-api-key")
        self.assertEqual(payload["to"], ["student@example.com"])
        self.assertIn("/#coach_invitation=JINV-token_value", payload["text_body"])
        self.assertIn("Coach &lt;David&gt;", payload["html_body"])
        self.assertIn("Open Player Profile", payload["text_body"])
        self.assertIn("Accept invitation", payload["text_body"])
        self.assertIn("do not need a separate Jetta Access Code", payload["text_body"])
        self.assertIn(">Join Jetta</a>", payload["html_body"])
        self.assertNotIn("private-api-key", json.dumps(result))
        self.assertEqual(result["status"], "SENT")

    @patch("packages.accounts.smtp2go.urlopen")
    def test_http_success_with_provider_failure_is_not_reported_as_sent(self, urlopen):
        urlopen.return_value = _Response({"data": {"succeeded": 0, "failed": 1}})
        mailer = SMTP2GOMailer(SMTP2GOConfig("key", "sender@example.com"))
        with self.assertRaises(EmailDeliveryError):
            mailer.send_coach_invitation("student@example.com", "Coach", "JINV-token")


if __name__ == "__main__":
    unittest.main()
