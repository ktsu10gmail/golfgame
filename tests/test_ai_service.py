import os
import unittest

from packages.ai.service import AiService, GeminiProviderError, create_ai_service
from packages.ai.prompts import build_round_prompt, build_shot_prompt


class FakeProvider:
    def __init__(self, response):
        self.response = response
        self.model = "fake-model"
        self.prompt = None

    def generate_json(self, prompt: str):
        self.prompt = prompt
        return self.response


class AiPromptTests(unittest.TestCase):
    def test_shot_prompt_embeds_schema_and_payload(self) -> None:
        prompt = build_shot_prompt({"club": "7 Iron", "remaining_yards": 132})
        self.assertIn("strict JSON", prompt)
        self.assertIn('"remaining_yards": 132', prompt)
        self.assertIn("decision_assessment", prompt)

    def test_round_prompt_embeds_schema_and_payload(self) -> None:
        prompt = build_round_prompt({"score_to_par": 4})
        self.assertIn("strict JSON", prompt)
        self.assertIn('"score_to_par": 4', prompt)
        self.assertIn("priority", prompt)


class AiServiceTests(unittest.TestCase):
    def test_status_reports_disabled_without_provider(self) -> None:
        service = AiService(provider=None)
        self.assertEqual(service.status()["enabled"], False)

    def test_narrate_shot_normalizes_provider_response(self) -> None:
        provider = FakeProvider({
            "summary": "Solid miss.",
            "decision_assessment": "sound",
            "execution_assessment": "missed",
            "next_play": "Play to the fat side."
        })
        service = AiService(provider=provider)
        response = service.narrate_shot({"club": "7 Iron"})
        self.assertEqual(response["provider"], "gemini")
        self.assertEqual(response["model"], "fake-model")
        self.assertEqual(response["summary"], "Solid miss.")
        self.assertIn('"club": "7 Iron"', provider.prompt)

    def test_review_round_normalizes_provider_response(self) -> None:
        provider = FakeProvider({
            "verdict": "The driver created the biggest swings.",
            "strength": "Short irons",
            "priority": "Driver target selection"
        })
        service = AiService(provider=provider)
        response = service.review_round({"score_to_par": 3})
        self.assertEqual(response["priority"], "Driver target selection")
        self.assertIn('"score_to_par": 3', provider.prompt)

    def test_service_raises_when_gemini_not_configured(self) -> None:
        service = AiService(provider=None)
        with self.assertRaisesRegex(GeminiProviderError, "not configured"):
            service.narrate_shot({})

    def test_create_ai_service_reads_environment(self) -> None:
        previous = os.environ.get("GEMINI_API_KEY")
        previous_model = os.environ.get("GEMINI_MODEL")
        try:
            os.environ["GEMINI_API_KEY"] = "test-key"
            os.environ["GEMINI_MODEL"] = "gemini-test"
            service = create_ai_service()
            self.assertTrue(service.status()["enabled"])
            self.assertEqual(service.status()["model"], "gemini-test")
        finally:
            if previous is None:
                os.environ.pop("GEMINI_API_KEY", None)
            else:
                os.environ["GEMINI_API_KEY"] = previous
            if previous_model is None:
                os.environ.pop("GEMINI_MODEL", None)
            else:
                os.environ["GEMINI_MODEL"] = previous_model


if __name__ == "__main__":
    unittest.main()
