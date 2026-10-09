# Mapper development on .47 and working fallback on .15

Develop and test Mapper on .47 in `/home/ksu/mapper47/app`, branch `mapper/dev47`. Keep .15 `/home/ksu/golfgame` as the working fallback. Source branches and commits are local checkpoints until explicitly pushed. Neither runtime database nor credentials belong in Git.

Both services keep independent Library databases, saved projects and course catalogs. Code deployment does not synchronize course edits or install courses into the game. Existing approved-course transfers are a separate action.

## Test and prepare a release

Run the Mapper/full JavaScript checks using the installed Node 22 runtime, and test the editor in your browser. Commit only reviewed source changes on .47. Runtime catalog changes must not be staged.

```sh
cd /home/ksu/mapper47/app
PATH=/home/ksu/mapper47/tools/node/bin:$PATH node --test tests/*.test.mjs
python3 -m unittest tests.test_mapper_release -v
python3 scripts/mapper_release.py prepare --commit HEAD --output /home/ksu/mapper47/releases/candidate.json
python3 scripts/mapper_release.py check /home/ksu/mapper47/releases/candidate.json
```

Preparation uses committed source, not unsaved/unstaged edits. The release manifest contains the exact source commit, source hashes and expected target hashes. `check` is read-only. Inspect changed files before deployment.

## Explicit promotion after owner acceptance

```sh
python3 scripts/mapper_release.py deploy /home/ksu/mapper47/releases/candidate.json
```

This replaces only allowlisted Mapper frontend/source files and restarts the .15 Mapper service. It refuses target source drift, backs up the affected source first, checks editor HTTP health, and automatically restores source if activation fails. Backend/account/installation changes require their own reviewed release workflow; this tool does not transfer them.

Save the returned backup path. To restore that release's preceding source:

```sh
python3 scripts/mapper_release.py rollback /home/ksu/golfgame/data/backups/mapper-code-RETURNED-PATH
```

Rollback refuses to overwrite later edits. A deployment leaves changed files in .15's Git working tree; inspect and record a new stable checkpoint afterward. The dev commit identifies the released source; no branch reset or database rollback is performed.

## Moving the fallback to cloud

Target SSH host, port, project directory, key path and service name are configuration in `.47 /home/ksu/.config/jetta/mapper-target.json`. Update this file when the stable host moves; prepare a fresh release for that target. The target must have Python 3, user systemd and Mapper serving localhost:8081 for the current health check. No NAS mount is required by the deploy/rollback commands.

Provider credentials are managed separately through `/home/ksu/.config/jetta/providers.env`. Source promotion does not carry passwords, API keys, `.env`, Library SQLite, `Courses/`, catalog JSON or imported course directories. Keep private backups and retain .15 until you explicitly decide otherwise.
