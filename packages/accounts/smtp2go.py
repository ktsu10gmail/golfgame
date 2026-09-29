"""SMTP2GO delivery for Coach invitation notifications."""

from __future__ import annotations

import html
import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


SMTP2GO_SEND_URL = "https://api.smtp2go.com/v3/email/send"


class EmailDeliveryError(RuntimeError):
    """A configured email provider could not accept a message."""


@dataclass(frozen=True)
class SMTP2GOConfig:
    api_key: str
    sender: str
    public_url: str = "https://golfgame.jetta.com"
    reply_to: str | None = None

    @classmethod
    def from_values(
        cls,
        api_key: str | None,
        sender: str | None,
        public_url: str | None = None,
        reply_to: str | None = None,
    ) -> "SMTP2GOConfig | None":
        clean_key = str(api_key or "").strip()
        clean_sender = str(sender or "").strip()
        if not clean_key and not clean_sender:
            return None
        if not clean_key or not clean_sender:
            raise ValueError("SMTP2GO_API_KEY and SMTP2GO_SENDER must be configured together")
        clean_url = str(public_url or "https://golfgame.jetta.com").strip().rstrip("/")
        if not clean_url.startswith(("https://", "http://")):
            raise ValueError("GOLFGAME_PUBLIC_URL must be an http or https URL")
        return cls(clean_key, clean_sender, clean_url, str(reply_to or "").strip() or None)


class SMTP2GOMailer:
    def __init__(self, config: SMTP2GOConfig):
        self.config = config

    def send_coach_invitation(
        self, recipient: str, coach_name: str, invitation_token: str
    ) -> dict[str, Any]:
        email = str(recipient or "").strip().lower()
        if "@" not in email:
            raise EmailDeliveryError("the invitation does not have a deliverable email address")
        coach = " ".join(str(coach_name or "Your Coach").strip().split())[:80] or "Your Coach"
        token = str(invitation_token or "").strip()
        if not token.startswith("JINV-"):
            raise EmailDeliveryError("the Coach invitation token is invalid")
        account_url = (
            f"{self.config.public_url}/#coach_invitation={quote(token, safe='')}"
        )
        subject = f"{coach} invited you to connect on Jetta Golf"
        text_body = (
            f"{coach} invited you to join their coaching roster on Jetta Golf.\n\n"
            f"Open Jetta Golf: {account_url}\n\n"
            "Sign in with this email address, open Player Account, and review the "
            "Coach invitation. You decide whether to accept it.\n\n"
            "If you were not expecting this invitation, you can ignore this email."
        )
        safe_coach = html.escape(coach)
        safe_url = html.escape(account_url, quote=True)
        html_body = (
            "<div style=\"font-family:Arial,sans-serif;color:#183126;line-height:1.55\">"
            "<p style=\"font-size:12px;letter-spacing:.08em;text-transform:uppercase\">"
            "Jetta Golf · Coach invitation</p>"
            f"<h1 style=\"font-size:24px\">{safe_coach} invited you to connect.</h1>"
            "<p>Sign in with this email address, open <strong>Player Account</strong>, "
            "and review the Coach invitation. You decide whether to accept it.</p>"
            f"<p><a href=\"{safe_url}\" style=\"display:inline-block;padding:12px 18px;"
            "background:#315a3b;color:#fff;text-decoration:none;border-radius:6px\">"
            "Open Jetta Golf</a></p>"
            "<p style=\"font-size:13px;color:#5d6b61\">If you were not expecting this "
            "invitation, you can ignore this email.</p></div>"
        )
        payload: dict[str, Any] = {
            "sender": self.config.sender,
            "to": [email],
            "subject": subject,
            "text_body": text_body,
            "html_body": html_body,
            "fastaccept": True,
        }
        if self.config.reply_to:
            payload["custom_headers"] = [{"header": "Reply-To", "value": self.config.reply_to}]
        request = Request(
            SMTP2GO_SEND_URL,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-Smtp2go-Api-Key": self.config.api_key,
            },
        )
        try:
            with urlopen(request, timeout=10) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raise EmailDeliveryError(f"SMTP2GO rejected the message ({error.code})") from error
        except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
            raise EmailDeliveryError("SMTP2GO could not be reached") from error
        data = result.get("data") if isinstance(result, dict) else None
        succeeded = data.get("succeeded") if isinstance(data, dict) else 0
        failed = data.get("failed") if isinstance(data, dict) else 0
        if not isinstance(succeeded, int) or succeeded < 1 or failed:
            raise EmailDeliveryError("SMTP2GO did not accept the invitation email")
        return {
            "status": "SENT",
            "provider": "SMTP2GO",
            "message_id": str(data.get("email_id") or "") or None,
            "request_id": str(result.get("request_id") or "") or None,
        }
