from pathlib import Path
import unittest

from packages.golf_domain import LieType, ShotIntent, load_lies, load_profiles


FIXTURES = Path(__file__).parents[1] / "data" / "fixtures"


class CatalogTests(unittest.TestCase):
    def test_versioned_profiles_load_with_unique_clubs(self) -> None:
        profiles = load_profiles(FIXTURES / "default_profiles.json")

        self.assertEqual({profile.profile_id for profile in profiles}, {"80_plus", "90_plus", "100_plus"})
        self.assertTrue(all(profile.version == "2026.07.1" for profile in profiles))
        self.assertEqual(profiles[1].club("7_iron").carry_mean, 133)

    def test_lie_fixture_covers_canonical_lies(self) -> None:
        lies = load_lies(FIXTURES / "lie_catalog.json")

        self.assertEqual(set(lies), set(LieType))
        self.assertLess(lies[LieType.ROUGH_DEEP].carry_multiplier, 1)
        self.assertGreater(lies[LieType.ROUGH_DEEP].mishit_multiplier, 1)

    def test_invalid_intent_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ShotIntent(distance_multiplier=2.0)


if __name__ == "__main__":
    unittest.main()

