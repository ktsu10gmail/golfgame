import json
import unittest
from unittest.mock import patch

from packages.accounts import AccountError, SupabaseAuth, SupabaseConfig


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


class SupabaseAuthTests(unittest.TestCase):
    def test_empty_configuration_uses_local_auth(self):
        self.assertIsNone(SupabaseConfig.from_values(None, None))

    def test_partial_configuration_is_rejected(self):
        with self.assertRaises(AccountError):
            SupabaseConfig.from_values("https://project.supabase.co", "")

    def test_public_configuration_contains_only_the_publishable_key(self):
        config = SupabaseConfig.from_values("https://project.supabase.co/", "anon-key")
        self.assertEqual(config.public_payload(), {
            "provider": "supabase",
            "url": "https://project.supabase.co",
            "anon_key": "anon-key",
        })

    @patch("packages.accounts.supabase.urlopen")
    def test_access_token_resolves_a_normalized_player(self, request):
        request.return_value = FakeResponse({
            "id": "user-123",
            "email": "golfer@example.com",
            "user_metadata": {"display_name": "  Kay   Smith  "},
        })
        auth = SupabaseAuth(SupabaseConfig("https://project.supabase.co", "anon-key"))
        self.assertEqual(auth.get_user("access-token"), {
            "external_id": "user-123",
            "email": "golfer@example.com",
            "name": "Kay Smith",
        })
        sent = request.call_args.args[0]
        self.assertEqual(sent.headers["Authorization"], "Bearer access-token")


if __name__ == "__main__":
    unittest.main()
