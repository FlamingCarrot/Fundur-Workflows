# Backups and restore

Nothing on the platform should be lost, and the way back has to be known before
it is needed (P1-16).

## What is kept

| What | Where | How long |
| --- | --- | --- |
| The database | Neon's own point-in-time history | Whatever the Neon plan gives (7 days on the free plan, longer on a paid one) |
| A full copy of every table | `backups/YYYY-MM-DD.json` in the Vercel Blob store, private | 30 days |
| Project files | The Vercel Blob store itself | Until deleted; every version is kept, so a restore never overwrites one |

The daily copy is the one that survives the database. Files are not copied into
it: the store keeps them, and the copy lists every file the database expects, so
a run that cannot find one says so.

## The daily run

`vercel.json` calls `GET /api/cron/backup` at 01:00 UTC. Vercel sends
`CRON_SECRET`; the Admin can also open the same URL while signed in, which is
the way to check it by hand. It answers with the row counts, the number of
files listed, and anything missing from storage. A missing file answers 500, so
a failed run shows in Vercel's logs.

## Restoring

1. Make a scratch Neon database and point `DATABASE_URL` at it.
2. `npm run db:migrate` creates the schema.
3. `npm run db:restore -- <path-to-backup.json>` writes the backup into it.

The restore is written to be run twice safely: rows already there are left
alone. It ends by comparing the row counts with the backup and refuses to call
itself done if they differ.

To put a restored database in front of the app, point the Vercel project's
`DATABASE_URL` at it and redeploy. Files need no restore: they are in the Blob
store the whole time, and the restored database points at the same paths.

## Checking it works

`npm test` runs `tests/backup-restore.test.ts`, which takes a backup of a studio
with a project, a brief, a stored file and a reported issue, restores it into an
empty database, and compares what the app reads back. That is the restore test
the plan asks for, and it runs on every change.
