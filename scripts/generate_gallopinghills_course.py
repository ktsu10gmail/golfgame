#!/usr/bin/env python3
"""Generate Galloping Hill's testing-quality schematic course geometry.

The supplied GPS aerials, supplied scorecard snippet, and official course
scorecard are the source. Positive lateral offsets are golfer-right along the
local route. The shared generator writes the project's native JSON schema.
"""

from pathlib import Path

import generate_themeadow_course as generator


ROOT = Path(__file__).resolve().parents[1]

# Blue/White men's par and handicap are authoritative for the normalized game
# scorecard. The official Gold row uses separate par and handicap values, while
# this app currently stores one par/handicap row per hole.
SCORECARD = {
    1: (4, 13, 329, 311, 307), 2: (4, 15, 332, 316, 308),
    3: (4, 1, 439, 415, 366), 4: (4, 9, 350, 333, 295),
    5: (3, 17, 127, 116, 95), 6: (5, 3, 533, 460, 414),
    7: (4, 5, 372, 344, 335), 8: (4, 11, 376, 335, 316),
    9: (4, 7, 369, 339, 288), 10: (4, 6, 390, 373, 276),
    11: (3, 18, 184, 136, 122), 12: (4, 10, 385, 272, 269),
    13: (4, 8, 373, 353, 307), 14: (4, 2, 400, 369, 344),
    15: (3, 16, 183, 167, 153), 16: (4, 12, 359, 328, 320),
    17: (4, 14, 280, 228, 215), 18: (5, 4, 492, 375, 373),
}

# Normalized route controls: (golfer-lateral meters, fraction of White length).
# The supplied screenshots orient every hole from its tee toward the green.
ROUTES = {
    1: ("Gentle Dogleg Right", [(0, 0), (-2, .42), (12, .72), (28, 1)]),
    2: ("Dogleg Right", [(0, 0), (5, .40), (20, .70), (38, 1)]),
    3: ("Dogleg Right / Water Left", [(0, 0), (4, .38), (24, .69), (48, 1)]),
    4: ("Gentle Dogleg Right", [(0, 0), (2, .42), (15, .72), (31, 1)]),
    5: ("Straight Par 3 / Slight Right", [(0, 0), (2, .52), (8, 1)]),
    6: ("Dogleg Right / Residential Boundary Left", [(0, 0), (4, .38), (23, .69), (47, 1)]),
    7: ("Dogleg Right", [(0, 0), (3, .42), (19, .71), (36, 1)]),
    8: ("Dogleg Right", [(0, 0), (3, .40), (21, .70), (43, 1)]),
    9: ("Dogleg Right", [(0, 0), (4, .40), (24, .70), (49, 1)]),
    10: ("Dogleg Right / Highway Boundary Right", [(0, 0), (3, .42), (18, .72), (35, 1)]),
    11: ("Straight Par 3", [(0, 0), (1, .52), (3, 1)]),
    12: ("Dogleg Right / Water Left", [(0, 0), (3, .37), (22, .68), (42, 1)]),
    13: ("Gentle Dogleg Right / Residential Boundary Left", [(0, 0), (2, .42), (16, .72), (32, 1)]),
    14: ("Dogleg Right / Residential Boundary Right", [(0, 0), (4, .40), (23, .69), (42, 1)]),
    15: ("Straight Par 3", [(0, 0), (1, .52), (2, 1)]),
    16: ("Dogleg Right", [(0, 0), (4, .40), (23, .70), (43, 1)]),
    17: ("Gentle Dogleg Right", [(0, 0), (2, .42), (13, .72), (25, 1)]),
    18: ("Strong Dogleg Right / Water Left", [(0, 0), (8, .34), (34, .66), (64, 1)]),
}

# type, route fraction, signed golfer-relative offset, length, width
FEATURES = {
    1: [],
    2: [("bunker", .58, 19, 17, 8)],
    3: [
        ("water", .48, -39, 44, 26),
        ("bunker", .65, -20, 16, 8),
        ("bunker", .76, 20, 16, 8),
    ],
    4: [("bunker", .61, -19, 16, 8)],
    5: [("bunker", .90, 14, 13, 7), ("bunker", .985, 20, 12, 7)],
    6: [],
    7: [("bunker", .54, 19, 17, 8), ("bunker", .93, -14, 13, 7)],
    8: [("bunker", .57, 20, 18, 8), ("bunker", .92, 14, 13, 7)],
    9: [
        ("bunker", .57, 19, 16, 8),
        ("bunker", .90, -14, 12, 7),
        ("bunker", .94, -21, 12, 7),
        ("bunker", .985, -27, 11, 7),
    ],
    10: [],
    11: [("bunker", .90, -13, 13, 7)],
    12: [
        ("water", .39, -30, 58, 40),
        ("bunker", .40, 19, 16, 8),
        ("bunker", .56, 20, 18, 8),
        ("bunker", .73, 19, 18, 8),
        ("bunker", .95, 14, 13, 7),
    ],
    13: [("bunker", .55, -19, 17, 8)],
    14: [("bunker", .55, 19, 18, 8)],
    15: [("bunker", .91, -13, 13, 7), ("bunker", .93, 14, 15, 8)],
    16: [("bunker", .54, 19, 17, 8), ("bunker", .70, 20, 17, 8)],
    17: [
        ("bunker", .63, 19, 16, 8),
        ("bunker", .77, 18, 15, 8),
        ("bunker", .94, 14, 13, 7),
    ],
    18: [
        ("water", .31, -32, 66, 38),
        ("bunker", .70, -19, 17, 8),
        ("bunker", .79, -18, 16, 8),
        ("bunker", .93, -14, 13, 7),
        ("bunker", .95, 15, 13, 7),
    ],
}

OUT_OF_BOUNDS = {
    4: "right",
    6: "left",
    9: "right",
    10: "right",
    13: "left",
    14: "right",
    18: "right",
}

# Net elevation transcribed from the arrows in the supplied GPS screenshots
# and converted from feet to meters.
NET_ELEVATION_METERS = {
    1: -12.5, 2: 14.3, 3: -25.6, 4: .9, 5: 6.7, 6: -6.1,
    7: 7.0, 8: -17.1, 9: 12.2, 10: 11.3, 11: -4.3, 12: 1.8,
    13: -7.0, 14: 3.4, 15: -.6, 16: 1.8, 17: 1.5, 18: -7.6,
}


def main() -> None:
    generator.COURSE_DIR = ROOT / "data" / "gallopinghills"
    generator.COURSE_NAME = "Galloping Hill Golf Course"
    generator.COURSE_LABEL = "Galloping Hill"
    generator.CALIBRATION_VERSION = "gallopinghills-aerial-review-v1"
    generator.SCORECARD = SCORECARD
    generator.ROUTES = ROUTES
    generator.FEATURES = FEATURES
    generator.OUT_OF_BOUNDS = OUT_OF_BOUNDS
    generator.NET_ELEVATION_METERS = NET_ELEVATION_METERS
    generator.main()


if __name__ == "__main__":
    main()
