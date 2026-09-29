"""Local player accounts and server-backed round persistence."""

from .store import AccountError, PlayerStore
from .supabase import SupabaseAuth, SupabaseConfig
from .learning import attach_verified_learning_context
from .licensing import LicenseError, LicenseService, PlayAccessDenied
from .admin_operations import AdminOperationsService
from .smtp2go import EmailDeliveryError, SMTP2GOConfig, SMTP2GOMailer

__all__ = [
    "AccountError", "PlayerStore", "SupabaseAuth", "SupabaseConfig",
    "attach_verified_learning_context", "LicenseError", "LicenseService", "PlayAccessDenied",
    "AdminOperationsService",
    "EmailDeliveryError", "SMTP2GOConfig", "SMTP2GOMailer",
]
