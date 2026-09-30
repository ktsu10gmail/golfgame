"""Scheduled licensing reconciliation and transactional notification delivery."""

from __future__ import annotations

import socket
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError

from .email_templates import render_license_notification
from .licensing import LicenseService
from .smtp2go import EmailDeliveryError, SMTP2GOMailer


class LicenseNotificationService:
    def __init__(
        self,
        licenses: LicenseService,
        mailer: SMTP2GOMailer | None,
        *,
        delivery_enabled: bool,
        batch_size: int = 50,
        claim_minutes: int = 15,
    ):
        self.licenses = licenses
        self.mailer = mailer
        self.delivery_enabled = bool(delivery_enabled)
        self.batch_size = max(1, min(int(batch_size), 100))
        self.claim_minutes = max(1, int(claim_minutes))

    @staticmethod
    def _error_code(error: Exception) -> str:
        if isinstance(error, HTTPError):
            return "PROVIDER_REJECTED"
        if isinstance(error, (URLError, TimeoutError, socket.timeout)):
            return "TIMEOUT"
        if isinstance(error, EmailDeliveryError):
            text = str(error).casefold()
            return "PROVIDER_REJECTED" if "rejected" in text else "DELIVERY_FAILED"
        return "DELIVERY_FAILED"

    def run_once(
        self, *, at: datetime | None = None, worker_id: str | None = None
    ) -> dict[str, int]:
        reconciled = self.licenses.reconcile_subscription_lifecycle(at)
        notices = self.licenses.claim_due_notifications(
            at=at, limit=self.batch_size, worker_id=worker_id,
            claim_minutes=self.claim_minutes,
        )
        summary = {"reconciled": reconciled, "claimed": len(notices), "sent": 0,
                   "failed": 0, "cancelled": 0}
        for notice in notices:
            token = notice["claim_token"]
            if not self.licenses.notification_claim_is_current(notice["id"], token):
                self.licenses.cancel_notification_claim(notice["id"], token)
                summary["cancelled"] += 1
                continue
            if not self.delivery_enabled or self.mailer is None:
                self.licenses.fail_notification(
                    notice["id"], token, "NOT_CONFIGURED", at=at,
                )
                summary["failed"] += 1
                continue
            context = dict(notice)
            context["restoration"] = (
                "Enter a new eligible Jetta Access Code in Player Profile, or contact Jetta support."
                if notice["billing_provider"] == "ACCESS_CODE"
                else "Contact Jetta support to restore Coach access."
            )
            if notice["notification_type"] == "STUDENT_SPONSORSHIP_ENDED":
                access = self.licenses.access_summary(notice["recipient_player_id"])
                context["has_other_valid_grant"] = bool(access["grants"])
            message = render_license_notification(notice["notification_type"], context)
            try:
                delivery = self.mailer.send_message(
                    notice["recipient_email"], message.subject,
                    message.text_body, message.html_body,
                )
            except Exception as error:  # provider failures are isolated per recipient
                self.licenses.fail_notification(
                    notice["id"], token, self._error_code(error), at=at,
                )
                summary["failed"] += 1
                continue
            self.licenses.complete_notification(notice["id"], token, delivery, at=at)
            summary["sent"] += 1
        return summary
