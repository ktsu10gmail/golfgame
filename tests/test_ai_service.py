import json
import unittest
from unittest.mock import patch

from packages.ai.service import (
    AiProviderError,
    AiService,
    OllamaProvider,
    create_ai_service,
)
from packages.ai.prompts import (
    COMPETITION_DECISION_RESPONSE_SCHEMA,
    GPS_HOLE_REVIEW_RESPONSE_SCHEMA,
    ROUND_RESPONSE_SCHEMA,
    SHOT_RESPONSE_SCHEMA,
    STRATEGY_RESPONSE_SCHEMA,
    build_gps_hole_review_prompt,
    build_competition_decision_prompt,
    build_round_prompt,
    build_shot_prompt,
    build_strategy_prompt,
)


class FakeProvider:
    def __init__(self, response):
        self.response = response
        self.model = "fake-model"
        self.name = "fake"
        self.prompt = None
        self.schema = None

    def generate_json(self, prompt: str, schema: dict):
        self.prompt = prompt
        self.schema = schema
        return self.response


class AiPromptTests(unittest.TestCase):
    def test_competition_prompt_excludes_future_execution(self) -> None:
        prompt = build_competition_decision_prompt({
            "profile": {"id": "90", "preferred_scoring_range_yards": [40, 80]},
            "situation": {"hole_number": 6, "distance_to_pin_yards": 187},
            "selected": {
                "club": "6 Iron", "power_percent": 90, "expected_score": 4.87,
                "evaluation": {"penalty_percent": 2, "median_leave_yards": 64},
            },
            "human_result": {"lie": "Bunker"},
        })
        self.assertIn('"expected_score": 4.87', prompt)
        self.assertNotIn("human_result", prompt)
        self.assertIn("execution outcome is intentionally absent", prompt)

    def test_gps_hole_review_prompt_limits_inferences_from_measured_distance(self) -> None:
        prompt = build_gps_hole_review_prompt({
            "hole": {"number": 4, "par": 4, "score": 5, "result": "Bogey"},
            "shots": [{"club": "7 Iron", "actual_distance_yards": 132}],
        })
        self.assertIn("GPS point-to-point distances", prompt)
        self.assertIn('"actual_distance_yards": 132', prompt)
        self.assertIn("Do not infer swing quality", prompt)
        self.assertIn('"summary"', prompt)

    def test_shot_prompt_embeds_schema_and_payload(self) -> None:
        prompt = build_shot_prompt(
            {
                "stroke": {
                    "club": "7 Iron",
                    "remaining_yards": 132,
                    "adjustment_reward": {"accuracy_bonus": 15, "base_accuracy": 65, "effective_accuracy": 80},
                    "strategy_packet": {"decision": {"advice_keys": ["rough_medium"]}},
                }
            }
        )
        self.assertIn("strict JSON", prompt)
        self.assertIn('"remaining_yards": 132', prompt)
        self.assertIn("decision_assessment", prompt)
        self.assertNotIn("result_packet", prompt)
        self.assertIn("Moderate rough. Lower expectations", prompt)
        self.assertIn('"accuracy_bonus": 15', prompt)
        self.assertIn("only to this shot", prompt)

    def test_round_prompt_embeds_schema_and_payload(self) -> None:
        prompt = build_round_prompt({
            "round": {"score_to_par": 4},
            "holes": [
                {"hole_number": 3, "meaningful": True, "score": 6, "review_shots": 2},
                {"hole_number": 4, "meaningful": False, "score": 4, "review_shots": 0},
            ],
        })
        self.assertIn("strict JSON", prompt)
        self.assertIn('"score_to_par": 4', prompt)
        self.assertIn("priority", prompt)
        self.assertIn('"hole_number": 3', prompt)
        self.assertNotIn('"hole_number": 4', prompt)
        self.assertIn("prompt_ready_review_guidance", prompt)
        self.assertIn("binding constraints", prompt)

    def test_strategy_prompt_prefers_normal_swings_and_embeds_clearance(self) -> None:
        prompt = build_strategy_prompt({
            "selected_choice_id": "safe",
            "choices": [{
                "id": "safe", "club": "8 Iron", "power_percent": 96,
                "hazard_clearance_yards": 72,
                "probability_analysis": {
                    "sample_count": 400, "target_percent": 46,
                    "playable_percent": 91, "penalty_percent": 2,
                },
            }],
            "probability_analysis": {"version": "multi-run-v1", "sample_count": 400, "analysis_seed": 17},
        })
        self.assertIn("quarter, half, three-quarter, or full swings", prompt)
        self.assertIn('"hazard_clearance_yards": 72', prompt)
        self.assertIn('"playable_percent": 91', prompt)
        self.assertIn("paired seeded outcomes", prompt)
        self.assertIn("paired-simulation result is authoritative", prompt)
        self.assertIn("recommended_choice_id", prompt)
        self.assertIn("do not produce prose", prompt)

    def test_ai_prompts_keep_only_verified_player_patterns(self) -> None:
        patterns = [
            {
                "kind": "lie_strength", "key": "rough_light",
                "confidence": "verified", "sample_size": 12, "round_count": 4,
                "decision_score": 88, "execution_score": 84,
            },
            {
                "kind": "sidehill_strength", "key": "sidehill_compensation",
                "confidence": "building", "sample_size": 40, "round_count": 10,
            },
        ]
        strategy_prompt = build_strategy_prompt({"choices": [], "verified_player_patterns": patterns})
        round_prompt = build_round_prompt({"holes": [], "verified_player_patterns": patterns})

        for prompt in (strategy_prompt, round_prompt):
            self.assertIn('"key": "rough_light"', prompt)
            self.assertNotIn('"key": "sidehill_compensation"', prompt)
            self.assertIn("server-verified", prompt)


class AiServiceTests(unittest.TestCase):
    def test_competition_explanation_uses_locked_decision_schema(self) -> None:
        provider = FakeProvider({
            "headline": "Lay up to the scoring zone",
            "reason": "The lower expected cost comes from the supplied playable-lie rate.",
            "concept": "preferred scoring distance",
            "confidence": "high",
        })
        response = AiService(provider=provider).explain_competition_decision({
            "selected": {"club": "6 Iron", "expected_score": 4.87},
            "alternatives": [{"club": "3 Wood", "expected_score": 5.21}],
        })
        self.assertEqual(response["headline"], "Lay up to the scoring zone")
        self.assertEqual(provider.schema, COMPETITION_DECISION_RESPONSE_SCHEMA)
        self.assertNotIn('"human_result"', provider.prompt)
        self.assertNotIn('"strategist_result"', provider.prompt)

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
        response = service.narrate_shot({"stroke": {"club": "7 Iron"}})
        self.assertEqual(response["provider"], "fake")
        self.assertEqual(response["model"], "fake-model")
        self.assertEqual(response["summary"], "Solid miss.")
        self.assertIn('"club": "7 Iron"', provider.prompt)
        self.assertEqual(provider.schema, SHOT_RESPONSE_SCHEMA)

    def test_review_gps_hole_returns_a_grounded_summary(self) -> None:
        provider = FakeProvider({"summary": "You made bogey with three full shots and two putts. Review the approach sequence."})
        service = AiService(provider=provider)
        response = service.review_gps_hole({"hole": {"number": 4, "score": 5}})
        self.assertEqual(response["summary"], provider.response["summary"])
        self.assertEqual(provider.schema, GPS_HOLE_REVIEW_RESPONSE_SCHEMA)
        self.assertIn("real-world golf hole", provider.prompt)

    def test_review_gps_hole_rejects_invented_shot_quality(self) -> None:
        provider = FakeProvider({"summary": "An accurate drive was followed by a missed approach."})
        with self.assertRaises(AiProviderError):
            AiService(provider=provider).review_gps_hole({"hole": {"number": 4}})

    def test_review_round_normalizes_provider_response(self) -> None:
        provider = FakeProvider({
            "verdict": "The driver created the biggest swings.",
            "strength": "Short irons",
            "priority": "Driver target selection",
            "hole_reviews": [
                {"hole_number": 5, "insight": "Penalty changed the hole.", "next_time": "Favor the fairway."},
                {"hole_number": 8, "insight": "Invented.", "next_time": "Ignore."},
                {"hole_number": 5, "insight": "Duplicate.", "next_time": "Ignore."},
            ],
        })
        service = AiService(provider=provider)
        response = service.review_round({
            "round": {"score_to_par": 3},
            "holes": [
                {"hole_number": 5, "meaningful": True},
                {"hole_number": 8, "meaningful": False},
            ],
        })
        self.assertEqual(response["priority"], "Driver target selection")
        self.assertEqual(response["hole_reviews"], [{
            "hole_number": 5,
            "insight": "Penalty changed the hole.",
            "credit": "The record does not show a specific strategic strength to credit on this hole.",
            "correction": "No specific correction is supported by the recorded shot evidence.",
            "next_time": "Favor the fairway.",
            "source": "ai",
        }])
        self.assertEqual(provider.schema, ROUND_RESPONSE_SCHEMA)

    def test_review_round_fills_an_omitted_meaningful_hole_from_verified_facts(self) -> None:
        provider = FakeProvider({
            "verdict": "One hole needs attention.",
            "strength": "Miss planning",
            "priority": "Target selection",
            "hole_reviews": [],
        })
        service = AiService(provider=provider)

        response = service.review_round({
            "holes": [{
                "hole_number": 7,
                "meaningful": True,
                "meaning_reasons": ["1 strategic decision to review"],
                "shots": [],
            }],
        })

        self.assertEqual(response["hole_reviews"], [{
            "hole_number": 7,
            "insight": "The recorded review flagged 1 strategic decision to review.",
            "credit": "The record does not show a specific strategic strength to credit on this hole.",
            "correction": "No specific correction is supported by the recorded shot evidence.",
            "next_time": "Use the recorded result to repeat the successful decision or adjust the next similar plan.",
            "source": "verified_fallback",
        }])

    def test_verified_fallback_separates_sound_decisions_from_missed_execution(self) -> None:
        provider = FakeProvider({
            "verdict": "Execution needs attention.",
            "strength": "Target selection",
            "priority": "Execution",
            "hole_reviews": [],
        })
        service = AiService(provider=provider)

        response = service.review_round({
            "holes": [{
                "hole_number": 3,
                "meaningful": True,
                "meaning_reasons": ["2 shots missed the plan"],
                "shots": [
                    {"stroke_number": 1, "club": "Driver", "power": 100, "decision_quality": "good", "execution_quality": "review"},
                    {"stroke_number": 2, "club": "7 Iron", "power": 95, "decision_quality": "good", "execution_quality": "review"},
                ],
            }],
        })

        review = response["hole_reviews"][0]
        self.assertIn("shot 1 (Driver with a full swing)", review["insight"])
        self.assertIn("shot 2 (7 Iron with a full swing)", review["insight"])
        self.assertIn("decisions were sound", review["insight"])
        self.assertIn("execution", review["next_time"])
        self.assertNotIn("Clean tee lie", review["next_time"])

    def test_verified_fallback_credits_player_sidehill_intent(self) -> None:
        provider = FakeProvider({
            "verdict": "The plan was better than the result.",
            "strength": "Lie management",
            "priority": "Execution",
            "hole_reviews": [],
        })
        service = AiService(provider=provider)

        response = service.review_round({
            "holes": [{
                "hole_number": 6,
                "meaningful": True,
                "meaning_reasons": ["1 shot missed the plan"],
                "shots": [{
                    "stroke_number": 2,
                    "club": "6 Iron",
                    "power": 100,
                    "decision_quality": "good",
                    "execution_quality": "review",
                    "player_intent": {"instructions": ["aim slightly right"]},
                    "sidehill_plan": {
                        "stance": "ball_above_feet",
                        "expected_curve_yards": -3,
                        "recommended_aim_yards": 3,
                        "player_aim_yards": 2.8,
                        "compensation": "correct",
                    },
                }],
            }],
        })

        review = response["hole_reviews"][0]
        self.assertIn("recorded player instruction", review["insight"])
        self.assertIn("2.8 yards right", review["insight"])
        self.assertIn("3-yard left sidehill curve", review["insight"])
        self.assertIn("decisions were sound", review["insight"])

    def test_verified_fallback_reports_temporary_adjustment_reward(self) -> None:
        provider = FakeProvider({"verdict": "Review", "strength": "Plan", "priority": "Repeat", "hole_reviews": []})
        service = AiService(provider=provider)

        response = service.review_round({
            "holes": [{
                "hole_number": 5,
                "meaningful": True,
                "meaning_reasons": ["1 correct lie response"],
                "shots": [{
                    "stroke_number": 2,
                    "club": "7 Iron",
                    "power": 100,
                    "decision_quality": "good",
                    "execution_quality": "good",
                    "adjustment_reward": {
                        "accuracy_bonus": 15,
                        "base_accuracy": 65,
                        "effective_accuracy": 80,
                    },
                }],
            }],
        })

        review = response["hole_reviews"][0]
        self.assertIn("temporary 15-point accuracy reward", review["credit"])
        self.assertIn("65% to 80% for that shot only", review["credit"])

    def test_review_rejects_an_unsupported_ai_swing_diagnosis(self) -> None:
        provider = FakeProvider({
            "verdict": "The plan was sound.",
            "strength": "Lie management",
            "priority": "Execution",
            "hole_reviews": [{
                "hole_number": 6,
                "insight": "The player struck poorly.",
                "credit": "The aim was correct.",
                "correction": "Fix the bad contact.",
                "next_time": "Make a better swing.",
            }],
        })
        service = AiService(provider=provider)

        response = service.review_round({
            "holes": [{
                "hole_number": 6,
                "meaningful": True,
                "meaning_reasons": ["1 shot missed the plan"],
                "shots": [{
                    "stroke_number": 2,
                    "club": "6 Iron",
                    "power": 100,
                    "decision_quality": "good",
                    "execution_quality": "review",
                }],
            }],
        })

        review = response["hole_reviews"][0]
        self.assertEqual(review["source"], "verified_fallback")
        self.assertNotIn("struck poorly", review["insight"])
        self.assertIn("decisions were sound", review["insight"])

    def test_critique_strategy_must_recommend_a_supplied_choice(self) -> None:
        provider = FakeProvider({
            "recommended_choice_id": "invented",
            "assessment": "challenge",
            "reason": "normal_swing",
            "comparison_choice_id": "invented",
        })
        service = AiService(provider=provider)
        response = service.critique_strategy({
            "selected_choice_id": "safe",
            "choices": [{
                "id": "safe", "title": "Safe miss", "club": "8 Iron",
                "power_percent": 96, "swing_type": "normal", "modeled_risk": 12,
                "deterministic_outlook": "Best", "leaves_yards": 8,
                "finish_surface": "green", "nearest_hazard": "bunker",
                "hazard_clearance_yards": 70,
                "probability_analysis": {
                    "sample_count": 400, "target_percent": 54,
                    "playable_percent": 92, "penalty_percent": 1,
                },
                "advice_keys": ["rough_medium", "greenside_bunker_in_play", "favor_safe_side"],
            }],
        })
        self.assertEqual(response["recommended_choice_id"], "safe")
        self.assertIn("8 Iron with a full swing", response["advice"])
        self.assertIn("Risk index: 12/100", response["advice"])
        self.assertIn("calculated recommendation", response["advice"])
        self.assertNotIn("modeled risk", response["advice"])
        self.assertIn("70 yards", response["advice"])
        self.assertIn("400 paired simulations", response["advice"])
        self.assertIn("92% stayed playable", response["advice"])
        self.assertIn("Moderate rough", response["library_guidance"])
        self.assertEqual(provider.schema, STRATEGY_RESPONSE_SCHEMA)

    def test_critique_strategy_cannot_override_deterministic_best(self) -> None:
        provider = FakeProvider({
            "recommended_choice_id": "aggressive",
            "assessment": "agree",
            "reason": "better_finish",
            "comparison_choice_id": "safe_smart",
        })
        service = AiService(provider=provider)
        response = service.critique_strategy({
            "selected_choice_id": "safe_smart",
            "choices": [
                {
                    "id": "aggressive", "title": "Aggressive", "club": "Driver",
                    "power_percent": 100, "swing_type": "normal", "modeled_risk": 51,
                    "deterministic_outlook": "Higher risk", "leaves_yards": 120,
                    "finish_surface": "fairway", "nearest_hazard": "bunker",
                    "hazard_clearance_yards": 1,
                },
                {
                    "id": "safe_smart", "title": "Safe & smart", "club": "5 Wood",
                    "power_percent": 100, "swing_type": "normal", "modeled_risk": 23,
                    "deterministic_outlook": "Best", "leaves_yards": 163,
                    "finish_surface": "fairway", "nearest_hazard": "bunker",
                    "hazard_clearance_yards": 16,
                },
            ],
        })
        self.assertEqual(response["recommended_choice_id"], "safe_smart")
        self.assertEqual(response["assessment"], "agree")
        self.assertIn("5 Wood with a full swing", response["advice"])
        self.assertIn("Risk index: 23/100", response["advice"])
        self.assertIn("risk index 51/100", response["tradeoff"])

    def test_critique_strategy_uses_hybrid_best_over_deterministic_fallback(self) -> None:
        provider = FakeProvider({
            "recommended_choice_id": "aggressive",
            "assessment": "agree",
            "reason": "better_finish",
            "comparison_choice_id": "safe_smart",
        })
        service = AiService(provider=provider)
        response = service.critique_strategy({
            "selected_choice_id": "aggressive",
            "probability_analysis": {
                "version": "multi-run-v1", "ranking_version": "course-management-v1",
                "sample_count": 400, "recommended_choice_id": "safe_smart",
            },
            "choices": [
                {
                    "id": "aggressive", "title": "Aggressive", "club": "Driver",
                    "power_percent": 100, "swing_type": "normal", "modeled_risk": 50,
                    "deterministic_outlook": "Best", "hybrid_outlook": "Higher risk",
                    "leaves_yards": 80, "finish_surface": "rough",
                },
                {
                    "id": "safe_smart", "title": "Safe & smart", "club": "5 Wood",
                    "power_percent": 100, "swing_type": "normal", "modeled_risk": 20,
                    "deterministic_outlook": "Higher risk", "hybrid_outlook": "Best",
                    "leaves_yards": 105, "finish_surface": "fairway",
                    "probability_analysis": {
                        "sample_count": 400, "target_percent": 68,
                        "playable_percent": 93, "penalty_percent": 2,
                    },
                },
            ],
        })
        self.assertEqual(response["recommended_choice_id"], "safe_smart")
        self.assertEqual(response["assessment"], "challenge")
        self.assertIn("simulation-backed recommendation", response["advice"])

    def test_critique_strategy_does_not_treat_simulated_distance_as_player_ability(self) -> None:
        provider = FakeProvider({
            "recommended_choice_id": "safe_smart",
            "assessment": "agree",
            "reason": "better_outlook",
            "comparison_choice_id": "aggressive",
        })
        service = AiService(provider=provider)
        response = service.critique_strategy({
            "selected_choice_id": "safe_smart",
            "choices": [{
                "id": "safe_smart", "title": "Safe & smart", "club": "6 Iron",
                "power_percent": 100, "swing_type": "normal", "modeled_risk": 18,
                "deterministic_outlook": "Best", "leaves_yards": 96,
                "finish_surface": "fairway",
                "verified_player_fit": {
                    "confidence": "verified", "kind": "preferred_distance_band",
                    "key": "80_109_yd", "label": "80–109 yards", "sample_size": 12,
                    "round_count": 4, "matches_band": True,
                },
            }],
        })

        self.assertNotIn("approach band", response["advice"])
        self.assertNotIn("12 shots across 4 completed rounds", response["advice"])

    def test_service_raises_when_provider_is_disabled(self) -> None:
        service = AiService(provider=None, disabled_reason="AI disabled for test")
        with self.assertRaisesRegex(AiProviderError, "disabled for test"):
            service.narrate_shot({})

    def test_create_ai_service_defaults_to_local_ollama(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            service = create_ai_service()
        self.assertEqual(
            service.status(),
            {"enabled": True, "provider": "ollama", "model": "qwen3.5:4b"},
        )

    def test_create_ai_service_reads_ollama_environment(self) -> None:
        environment = {
            "AI_PROVIDER": "ollama",
            "OLLAMA_MODEL": "qwen-test",
            "OLLAMA_HOST": "localhost:9999",
            "OLLAMA_NUM_CTX": "2048",
            "OLLAMA_TEMPERATURE": "0.1",
        }
        with patch.dict("os.environ", environment, clear=True):
            service = create_ai_service()
        self.assertEqual(service.status()["model"], "qwen-test")
        self.assertEqual(service.provider.host, "http://localhost:9999")
        self.assertEqual(service.provider.context_tokens, 2048)
        self.assertEqual(service.provider.temperature, 0.1)

    def test_create_ai_service_keeps_gemini_as_an_explicit_alternative(self) -> None:
        environment = {
            "AI_PROVIDER": "gemini",
            "GEMINI_API_KEY": "test-key",
            "GEMINI_MODEL": "gemini-test",
        }
        with patch.dict("os.environ", environment, clear=True):
            service = create_ai_service()
        self.assertEqual(
            service.status(),
            {"enabled": True, "provider": "gemini", "model": "gemini-test"},
        )

    def test_create_ai_service_can_be_disabled(self) -> None:
        with patch.dict("os.environ", {"AI_PROVIDER": "off"}, clear=True):
            service = create_ai_service()
        self.assertFalse(service.status()["enabled"])


class OllamaProviderTests(unittest.TestCase):
    @patch("packages.ai.service._json_request")
    def test_generate_json_uses_local_structured_output(self, request_json) -> None:
        request_json.return_value = {
            "response": json.dumps(
                {
                    "summary": "Safe choice, missed strike.",
                    "decision_assessment": "sound",
                    "execution_assessment": "missed",
                    "next_play": "Favor the center.",
                }
            )
        }
        provider = OllamaProvider(model="qwen-test", context_tokens=4096, temperature=0.3)

        result = provider.generate_json("golf prompt", SHOT_RESPONSE_SCHEMA)

        self.assertEqual(result["decision_assessment"], "sound")
        endpoint, request_body, timeout = request_json.call_args.args
        self.assertEqual(endpoint, "http://127.0.0.1:11434/api/generate")
        self.assertEqual(request_body["model"], "qwen-test")
        self.assertEqual(request_body["format"], SHOT_RESPONSE_SCHEMA)
        self.assertEqual(request_body["options"]["num_ctx"], 4096)
        self.assertEqual(request_body["options"]["num_predict"], 220)
        self.assertEqual(request_body["options"]["temperature"], 0.3)
        self.assertFalse(request_body["think"])
        self.assertEqual(timeout, 60)

    @patch("packages.ai.service._json_request")
    def test_round_review_allows_enough_output_for_multiple_holes(self, request_json) -> None:
        request_json.return_value = {
            "response": json.dumps({
                "verdict": "Review the costly holes.",
                "strength": "Miss planning",
                "priority": "Target selection",
                "hole_reviews": [],
            })
        }
        provider = OllamaProvider()

        provider.generate_json("round prompt", ROUND_RESPONSE_SCHEMA)

        request_body = request_json.call_args.args[1]
        self.assertEqual(request_body["options"]["num_predict"], 600)


if __name__ == "__main__":
    unittest.main()
