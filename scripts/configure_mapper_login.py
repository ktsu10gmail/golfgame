#!/usr/bin/env python3
"""Provision a local Mapper password without printing secrets."""
import argparse
import getpass
import os
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.mapper_access import password_hash


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate", action="store_true")
    parser.add_argument("--reuse-password-file", action="store_true",
                        help="rehash the existing private .mapper-password without printing or replacing it")
    args = parser.parse_args()
    if args.generate and args.reuse_password_file:
        raise SystemExit("Choose either --generate or --reuse-password-file")
    if args.reuse_password_file:
        credential_file = ROOT / ".mapper-password"
        # Editors may prepend a human-readable label to this private helper
        # file. Treat the final nonblank line as the credential so the label
        # is never accidentally included in the password hash.
        password_lines = [
            line.strip()
            for line in credential_file.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if not password_lines:
            raise SystemExit(".mapper-password does not contain a password")
        password = password_lines[-1]
    elif args.generate:
        password = secrets.token_urlsafe(18)
    else:
        password = getpass.getpass("New Mapper password: ")
        if password != getpass.getpass("Confirm password: "):
            raise SystemExit("Passwords do not match")
    if len(password) < 12 or len(password) > 512:
        raise SystemExit("Use a password between 12 and 512 characters")
    environment = ROOT / ".env"
    original = environment.read_text() if environment.exists() else ""
    keys = {"GOLFGAME_MAPPER_PASSWORD_HASH", "GOLFGAME_MAPPER_SERVICE_TOKEN"}
    lines = [line for line in original.splitlines() if line.split("=", 1)[0].strip() not in keys]
    lines += [f"GOLFGAME_MAPPER_PASSWORD_HASH={password_hash(password)}",
              f"GOLFGAME_MAPPER_SERVICE_TOKEN={secrets.token_urlsafe(48)}"]
    # Exclusive private file, then atomic replacement preserves all other settings.
    temporary = ROOT / (".env.mapper-" + secrets.token_hex(8))
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
            stream.write("\n".join(lines) + "\n")
        os.replace(temporary, environment)
    finally:
        temporary.unlink(missing_ok=True)
    if args.generate:
        credential_file = ROOT / ".mapper-password"
        descriptor = os.open(credential_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(password + "\n")
        print("Mapper password saved in .mapper-password (private and excluded from Git).")
    elif not args.reuse_password_file:
        (ROOT / ".mapper-password").unlink(missing_ok=True)
    print("Mapper access configured. Restart the App and Mapper services to activate.")


if __name__ == "__main__":
    main()
