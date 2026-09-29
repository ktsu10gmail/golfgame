#!/usr/bin/env python3
"""Serve the Jetta Course Mapper on its dedicated port."""

import os

os.environ["GOLFGAME_SERVER_ROLE"] = "mapper"

from serve import main


if __name__ == "__main__":
    main(default_port=int(os.getenv("GOLFGAME_MAPPER_PORT", "8081")), description=__doc__)
