"""Pure transactional email templates for licensing lifecycle notices."""

from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class EmailMessage:
    subject: str
    text_body: str
    html_body: str


def _deadline(value: Any) -> str:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime("%B %-d, %Y at %-I:%M %p UTC")
    except (TypeError, ValueError):
        return "the deadline shown in your Jetta Player Profile"


def _message(subject: str, heading: str, paragraphs: list[str]) -> EmailMessage:
    text = heading + "\n\n" + "\n\n".join(paragraphs)
    body = "".join(f"<p>{html.escape(paragraph)}</p>" for paragraph in paragraphs)
    rendered = (
        '<div style="font-family:Arial,sans-serif;color:#183126;line-height:1.55">'
        '<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase">'
        "Jetta Golf · Access notice</p>"
        f'<h1 style="font-size:24px">{html.escape(heading)}</h1>{body}</div>'
    )
    return EmailMessage(subject, text, rendered)


def coach_grace_daily(context: dict[str, Any]) -> EmailMessage:
    days = max(0, int(context.get("days_remaining") or 0))
    deadline = _deadline(context.get("grace_ends_at"))
    restoration = str(context.get("restoration") or "Contact Jetta support to restore access.")
    return _message(
        f"{days} days remaining — your Jetta Coach access needs attention",
        "Your Jetta Coach access needs attention",
        [
            f"{days} days remain in your Coach grace period.",
            "Your access and your existing sponsored students' access remain active during this period.",
            f"The exact grace deadline is {deadline}.",
            "If access is not restored by then, the Jetta access supplied through your Coach sponsorships will end. Student accounts and saved history remain available.",
            restoration,
        ],
    )


def student_grace_started(context: dict[str, Any]) -> EmailMessage:
    deadline = _deadline(context.get("grace_ends_at"))
    coach = str(context.get("coach_name") or "Your Coach")
    return _message(
        "Your Coach-sponsored Jetta access remains active",
        "Your Jetta access remains active",
        [
            f"{coach}'s Coach subscription is in a grace period.",
            f"Your Coach-sponsored access remains active until the exact deadline: {deadline}.",
            "Your Jetta account and saved history remain yours.",
            "You have earned preferred Student Continuation eligibility. Online subscription activation is not yet available, and your eligibility has been saved.",
        ],
    )


def coach_grace_expired(context: dict[str, Any]) -> EmailMessage:
    return _message(
        "Your Jetta Coach access has ended",
        "Your Jetta Coach access has ended",
        [
            "Your 30-day grace period has ended.",
            "The Jetta access previously supplied through your sponsored seats is no longer active.",
            "Student accounts, saved history, and coaching relationships have not been deleted.",
            "Contact Jetta support when you are ready to restore Coach access. Former students must be explicitly sponsored again after restoration.",
        ],
    )


def student_sponsorship_ended(context: dict[str, Any]) -> EmailMessage:
    has_other = bool(context.get("has_other_valid_grant"))
    access_copy = (
        "Your other valid Jetta access remains active."
        if has_other else
        "You can continue viewing your saved history. New entitled play depends on Jetta's current enforcement mode until you have another valid grant."
    )
    return _message(
        "Your Coach-sponsored Jetta access has ended",
        "Your Coach-sponsored access has ended",
        [
            "The access previously provided through your Coach sponsorship has ended.",
            access_copy,
            "Your account, saved history, and coaching relationship remain available.",
            "Your preferred Student Continuation eligibility has been saved. Online subscription activation is not yet available.",
        ],
    )


def render_license_notification(notification_type: str, context: dict[str, Any]) -> EmailMessage:
    renderers = {
        "COACH_GRACE_DAILY": coach_grace_daily,
        "STUDENT_GRACE_STARTED": student_grace_started,
        "COACH_GRACE_EXPIRED": coach_grace_expired,
        "STUDENT_SPONSORSHIP_ENDED": student_sponsorship_ended,
    }
    try:
        return renderers[notification_type](context)
    except KeyError as error:
        raise ValueError("unsupported licensing notification type") from error
