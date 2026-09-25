from scripts.export_game_master_dialogue import putt_leave


def test_putt_leave_uses_player_friendly_units() -> None:
    assert putt_leave(0.05) == "2 inches"
    assert putt_leave(0.27) == "10 inches"
    assert putt_leave(0.38) == "1.1 feet"
