#!/usr/bin/env python3
"""Generate Warrenbrook's reviewed testing-quality course geometry.

The supplied GPS aerials and the user's earlier hole-by-hole corrections are
authoritative. Positive lateral offsets are golfer-right along the local route.
"""

from pathlib import Path

import generate_themeadow_course as generator


ROOT = Path(__file__).resolve().parents[1]

SCORECARD = {
    1: (4, 5, 378, 355, 305), 2: (4, 13, 369, 349, 298),
    3: (4, 1, 407, 391, 315), 4: (3, 9, 186, 165, 152),
    5: (5, 11, 561, 558, 449), 6: (3, 7, 213, 199, 170),
    7: (4, 3, 365, 355, 345), 8: (5, 15, 473, 455, 407),
    9: (3, 17, 145, 125, 85), 10: (4, 8, 393, 371, 321),
    11: (4, 6, 364, 350, 280), 12: (3, 10, 174, 157, 130),
    13: (4, 2, 406, 390, 334), 14: (4, 16, 326, 311, 260),
    15: (5, 14, 522, 510, 407), 16: (4, 12, 345, 331, 287),
    17: (4, 4, 376, 355, 304), 18: (4, 18, 369, 347, 246),
}

# Normalized route controls: (golfer-lateral meters, fraction of White length).
ROUTES = {
    1: ("Mostly Straight / Slight Right Finish", [(0, 0), (-2, .42), (5, .73), (15, 1)]),
    2: ("Dogleg Left / Right Landing Bunker", [(0, 0), (5, .43), (-8, .72), (-31, 1)]),
    3: ("Mostly Straight / Slight Left", [(0, 0), (2, .45), (-4, .74), (-13, 1)]),
    4: ("Straight Par 3", [(0, 0), (0, .52), (1, 1)]),
    5: ("Multi-stage Dogleg Left", [(0, 0), (13, .34), (1, .65), (-53, 1)]),
    6: ("Straight Par 3 / Water Right", [(0, 0), (1, .52), (2, 1)]),
    7: ("Mostly Straight", [(0, 0), (1, .45), (3, .74), (5, 1)]),
    8: ("Strong Dogleg Right", [(0, 0), (-4, .36), (24, .68), (68, 1)]),
    9: ("Straight Par 3", [(0, 0), (0, .52), (1, 1)]),
    10: ("Mostly Straight", [(0, 0), (1, .43), (3, .73), (5, 1)]),
    11: ("Mostly Straight / Slight Right", [(0, 0), (-2, .43), (2, .73), (8, 1)]),
    12: ("Straight Par 3", [(0, 0), (0, .52), (1, 1)]),
    13: ("Mostly Straight", [(0, 0), (2, .43), (4, .73), (6, 1)]),
    14: ("Gentle Dogleg Left", [(0, 0), (4, .43), (-4, .73), (-18, 1)]),
    15: ("Multi-stage Dogleg Right", [(0, 0), (-5, .34), (27, .67), (73, 1)]),
    16: ("Mostly Straight / Slight Left Finish", [(0, 0), (2, .43), (-3, .73), (-12, 1)]),
    17: ("Dogleg Right / Water Near Green", [(0, 0), (-3, .42), (18, .70), (53, 1)]),
    18: ("Dogleg Left / Crossing Water", [(0, 0), (5, .42), (-8, .71), (-34, 1)]),
}

# type, route fraction, signed golfer-relative offset, length, width
FEATURES = {
    1: [("bunker", .47, 18, 17, 8)],
    2: [("bunker", .63, 18, 17, 8), ("bunker", .95, -15, 13, 7)],
    3: [("bunker", .95, -15, 14, 8)],
    4: [("bunker", .94, 15, 15, 8)],
    5: [("bunker", .94, -15, 14, 8), ("water", .93, 34, 66, 29)],
    6: [("water", .43, 29, 76, 34), ("bunker", .94, 16, 15, 8), ("bunker", .985, -19, 13, 7)],
    7: [("bunker", .48, 18, 18, 8)],
    8: [("bunker", .43, 18, 17, 8), ("bunker", .93, 15, 13, 7), ("bunker", .99, 22, 12, 7)],
    9: [("bunker", .97, -15, 14, 8)],
    10: [("bunker", .50, 18, 18, 8)],
    11: [("bunker", .95, -15, 14, 8)],
    12: [("bunker", .95, -15, 14, 8)],
    13: [("bunker", .49, 18, 17, 8), ("bunker", .95, 15, 14, 8)],
    14: [("bunker", .95, 15, 14, 8)],
    15: [("bunker", .40, 18, 17, 8), ("bunker", .83, 18, 16, 8), ("bunker", .86, 27, 16, 8)],
    16: [("bunker", .50, 18, 17, 8), ("bunker", .53, -19, 17, 8), ("bunker", .96, 15, 14, 8)],
    17: [("bunker", .48, -16, 17, 8), ("water", .82, 28, 82, 38)],
    18: [("water", .22, 0, 48, 46), ("bunker", .48, 18, 17, 8), ("bunker", .93, 15, 14, 8), ("bunker", .985, 22, 13, 7)],
}

OUT_OF_BOUNDS = {
    1: "right", 2: "left", 3: "left", 5: "left", 7: "right",
    8: "right", 14: "right", 15: "right", 16: "left", 17: "right", 18: "left",
}

# Net elevation transcribed from the GPS screenshots and converted from feet.
NET_ELEVATION_METERS = {
    1: 19.5, 2: -3.7, 3: .3, 4: 4.3, 5: -19.5, 6: 7.0,
    7: 14.3, 8: 5.8, 9: -5.8, 10: .9, 11: -4.0, 12: -3.4,
    13: 7.9, 14: -7.9, 15: -4.9, 16: 18.6, 17: 5.5, 18: 6.7,
}


def main() -> None:
    generator.COURSE_DIR = ROOT / "data" / "warrenbrook"
    generator.COURSE_NAME = "Warrenbrook Golf Course"
    generator.COURSE_LABEL = "Warrenbrook"
    generator.CALIBRATION_VERSION = "warrenbrook-aerial-review-v2"
    generator.SCORECARD = SCORECARD
    generator.ROUTES = ROUTES
    generator.FEATURES = FEATURES
    generator.OUT_OF_BOUNDS = OUT_OF_BOUNDS
    generator.NET_ELEVATION_METERS = NET_ELEVATION_METERS
    generator.main()


if __name__ == "__main__":
    main()
