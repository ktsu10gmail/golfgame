"""Shared application/worker construction for Jetta account services."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .admin_operations import AdminOperationsService
from .license_notifications import LicenseNotificationService
from .licensing import LicenseService
from .smtp2go import SMTP2GOConfig, SMTP2GOMailer
from .store import PlayerStore


def load_local_environment(path: Path) -> None:
    """Load simple KEY=VALUE settings without overriding service environment."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if name:
            os.environ.setdefault(name, value)


@dataclass(frozen=True)
class AccountRuntime:
    player_db_path: Path
    player_store: PlayerStore
    license_service: LicenseService
    admin_operations: AdminOperationsService
    smtp2go_mailer: SMTP2GOMailer | None
    notification_service: LicenseNotificationService
    email_delivery_enabled: bool


def create_account_runtime(root: Path) -> AccountRuntime:
    load_local_environment(root / ".env")
    path = Path(os.getenv("GOLFGAME_PLAYER_DB", root / "data" / "player_accounts.sqlite3"))
    store = PlayerStore(path)
    licenses = LicenseService(
        path,
        enforcement=os.getenv("GOLFGAME_LICENSE_ENFORCEMENT", "shadow"),
        coach_seat_capacity=int(os.getenv("GOLFGAME_COACH_SEAT_CAPACITY", "10")),
        coach_grace_days=int(os.getenv("GOLFGAME_COACH_GRACE_DAYS", "30")),
    )
    admin = AdminOperationsService(path, licenses)
    config = SMTP2GOConfig.from_values(
        os.getenv("SMTP2GO_API_KEY"), os.getenv("SMTP2GO_SENDER"),
        os.getenv("GOLFGAME_PUBLIC_URL"), os.getenv("SMTP2GO_REPLY_TO"),
    )
    enabled = os.getenv("GOLFGAME_EMAIL_DELIVERY", "disabled").strip().casefold() == "enabled"
    mailer = SMTP2GOMailer(config) if config and enabled else None
    notifications = LicenseNotificationService(
        licenses, mailer, delivery_enabled=enabled,
        batch_size=int(os.getenv("GOLFGAME_LICENSE_WORKER_BATCH_SIZE", "50")),
        claim_minutes=int(os.getenv("GOLFGAME_LICENSE_NOTIFICATION_CLAIM_MINUTES", "15")),
    )
    return AccountRuntime(path, store, licenses, admin, mailer, notifications, enabled)
