"""Load and validate versioned Phase 2 profile and lie fixtures."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .enums import LieType
from .models import ClubStat, LieModifier


@dataclass(frozen=True, slots=True)
class ProfileFixture:
    profile_id: str
    display_name: str
    typical_score: int
    clubs: tuple[ClubStat, ...]
    version: str

    def club(self, club_id: str) -> ClubStat:
        try:
            return next(club for club in self.clubs if club.club_id == club_id)
        except StopIteration as error:
            raise KeyError(f"unknown club_id: {club_id}") from error


def load_profiles(path: Path) -> tuple[ProfileFixture, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    version = str(payload["version"])
    profiles: list[ProfileFixture] = []
    seen: set[str] = set()
    for item in payload["profiles"]:
        profile_id = str(item["id"])
        if profile_id in seen:
            raise ValueError(f"duplicate profile id: {profile_id}")
        seen.add(profile_id)
        clubs = tuple(
            ClubStat(
                club_id=club_id,
                carry_mean=float(values["carry"]),
                carry_sd=float(values["carry_sd"]),
                roll_mean=float(values["roll"]),
                lateral_sd=float(values["lateral_sd"]),
                directional_bias=float(values["bias"]),
                mishit_probability=float(values["mishit"]),
            )
            for club_id, values in item["clubs"].items()
        )
        profiles.append(
            ProfileFixture(
                profile_id=profile_id,
                display_name=str(item["display_name"]),
                typical_score=int(item["typical_score"]),
                clubs=clubs,
                version=version,
            )
        )
    return tuple(profiles)


def load_lies(path: Path) -> dict[LieType, LieModifier]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    version = str(payload["version"])
    lies: dict[LieType, LieModifier] = {}
    for item in payload["lies"]:
        lie_type = LieType(item["id"])
        if lie_type in lies:
            raise ValueError(f"duplicate lie id: {lie_type}")
        lies[lie_type] = LieModifier(
            lie_type=lie_type,
            carry_multiplier=float(item["carry_multiplier"]),
            roll_multiplier=float(item["roll_multiplier"]),
            mishit_multiplier=float(item["mishit_multiplier"]),
            lateral_bias_yards=float(item.get("lateral_bias_yards", 0)),
            version=version,
        )
    missing = set(LieType) - set(lies)
    if missing:
        raise ValueError(f"lie fixture is missing canonical ids: {sorted(missing)}")
    return lies

