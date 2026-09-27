from scripts.export_game_master_dialogue import putt_leave, recorded_game_master_responses


def test_putt_leave_uses_player_friendly_units() -> None:
    assert putt_leave(0.05) == "2 inches"
    assert putt_leave(0.27) == "10 inches"
    assert putt_leave(0.38) == "1.1 feet"


def test_saved_game_master_responses_remain_bound_to_their_shot() -> None:
    document = {
        "round_state": {
            "holes": [{
                "events": [
                    {"event_type": "shot_committed", "stroke_index": 1, "payload": {"shot": {"club": "Driver"}}},
                    {"event_type": "gm_response_recorded", "stroke_index": 1, "payload": {"responses": [
                        {"source": "deterministic", "response_type": "decision-review", "text": "Competitive plan."}
                    ]}},
                    {"event_type": "gm_response_recorded", "stroke_index": 2, "payload": {"responses": [
                        {"source": "ai", "response_type": "ai-comment", "text": "Choose the wider target."}
                    ]}},
                ]
            }]
        }
    }

    responses = recorded_game_master_responses(document)

    assert responses[(1, 1)][0]["text"] == "Competitive plan."
    assert responses[(1, 2)][0]["text"] == "Choose the wider target."
