# Mapper .15 source snapshot and .47 preparation

This source checkpoint preserves the current owner development. It does not deploy .47 or change the isolated WP11 release authority.

Runtime data is transferred separately: use the online SQLite backup of `data/course_library.sqlite3` and the archive containing `Courses/` plus installed course data. Restore them under the checkout root on .47 before starting Mapper. The archive includes the live `data/mapped_courses.json`, which is deliberately excluded from this source commit. Existing bundled demonstration course fixtures remain tracked.

Keep `.env`, `.mapper-password`, API keys, databases, saved projects, imported course packages and backups out of Git. Provision .47 credentials locally; do not copy secrets into coordination reports. Point .47 at its own database paths and configure the existing Mapper service using its host-specific settings. Do not run .47 against .15's live SQLite files.

Backup integrity must pass SQLite `PRAGMA integrity_check`; every revision path in the snapshot must exist in the archive. Verify SHA-256 hashes against the manifest before restoring. Backups may contain private saved-project information and should remain restricted.

Leave .15 services running during backup and source commit. SQLite online backup supports that. Saved revision files are immutable; the archive verification checks all paths referenced by the database snapshot.

Shared coordination: .15 and .47 read/write `jetta-coordination`; public-facing .46 reads it only. Publish per-component progress and checkpoint links there. Backup archives belong outside that knowledge folder, in the sibling `jetta-backups` directory.
