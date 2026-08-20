import unittest

from packages.ai.advice_library import (
    approved_short_phrases,
    guidance_for_keys,
    guidance_text,
    round_review_prompt_guidance,
)


class AdviceLibraryTests(unittest.TestCase):
    def test_reads_approved_phrases_from_documentation(self) -> None:
        phrases = approved_short_phrases()
        self.assertEqual(
            phrases["rough_medium"],
            "Moderate rough. Lower expectations for control and play to the safe area.",
        )
        self.assertEqual(phrases["favor_safe_side"], "Favor the safe side.")

    def test_guidance_keeps_key_order_deduplicates_and_ignores_unknowns(self) -> None:
        guidance = guidance_for_keys([
            "rough_medium", "unknown", "water_in_play", "rough_medium", "favor_safe_side"
        ])
        self.assertEqual(
            [item["key"] for item in guidance],
            ["rough_medium", "water_in_play", "favor_safe_side"],
        )
        self.assertIn("Water is the main miss", guidance_text(["water_in_play"]))

    def test_round_review_guidance_is_loaded_from_prompt_ready_markdown(self) -> None:
        guidance = round_review_prompt_guidance()
        self.assertEqual(
            [item["source"] for item in guidance],
            [
                "STANDARD_ADVICE_LIBRARY.md",
                "COURSE_MANAGEMENT_ANALYSIS.md",
                "DECISION_SCORING_SPEC.md",
            ],
        )
        combined = " ".join(item["guidance"] for item in guidance)
        self.assertIn("Use authoritative shot facts first", combined)
        self.assertIn("AI should explain the decision analysis, not invent it", combined)
        self.assertIn("good plan, poor strike", combined)


if __name__ == "__main__":
    unittest.main()
