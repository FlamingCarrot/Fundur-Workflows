# Backups and restore

P1-16 requires a daily database and file backup with a tested restore.

## What is kept

| What | Where | Retention |
| --- | --- | --- |
| Database point-in-time history | Neon | Depends on the configured Neon plan; verify in the provider console |
| Database export and file manifest | Private Blob `backups/YYYY-MM-DD.json` | 30 daily manifests |
| Copies of original project files and their versions | Private Blob `backup-files/<SHA-256 of original path>` | While referenced by a retained manifest |

File copies are incremental: immutable original paths are copied once, checked for size, and referenced in each daily manifest. The backup includes orchestration, costs, proposals, shares, comments, invitations, assignments and audit tables as well as project data. Share comments restore parents before replies. Existing exports without file copies remain readable.

These copies protect against deletion of originals and database loss. They are in the **same Blob account** and do not protect against losing that whole account. Configure an independent export destination if account-level recovery is required. Keep backup access credentials and encryption keys in a separate secure recovery location; the JSON contains sensitive client data and encrypted provider credentials.

## Daily run

`vercel.json` schedules `GET /api/cron/backup` at 01:00 UTC. It accepts the configured `CRON_SECRET` or an authenticated platform Admin. The response reports database counts, files, copied files, missing originals and retention removals. Missing originals return 500; absent storage configuration returns 503. Inspect the deployed job and logs to confirm it actually runs.

Retention removes expired manifests and unreferenced backup file copies older than one day. It never deletes original project files. An unreadable retained manifest stops file-copy garbage collection so its files remain available.

## Restore

1. Download an authorized daily JSON export from private storage.
2. Create a scratch Neon database, set `DATABASE_URL`, and run `npm run db:migrate`.
3. Run `npm run db:restore -- <path-to-backup.json>`.
4. To recover missing original files too, configure the original Blob store credentials and run `npm run db:restore -- <path-to-backup.json> --restore-files`.
5. Review row-count checks and file recovery results. Open a restored project and download sample current and previous files before switching production to the restored database.

Database restore leaves existing rows alone and reports count mismatches. File restore validates project paths, hash-derived backup paths and file sizes; it recreates missing originals without overwriting existing ones. Older manifest-only exports cannot recreate deleted files. Never run a scratch restore against production accidentally.

`tests/backup-restore.test.ts` exercises database reconstruction, byte-for-byte file-copy recovery, deduplication, unsafe-path rejection and retention. This does not substitute for a provider-backed scratch restore using the live credentials and deployed scheduler.
