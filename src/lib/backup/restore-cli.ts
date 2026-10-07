import { loadEnvConfig } from "@next/env";
import { isStorageConfigured } from "@/lib/storage/blob";
import { blobStorage, restoreFiles } from "./run";
import * as fs from "fs";
import { getDb } from "@/lib/db";
import { checkRestore, restoreBackup, type Backup } from "./backup";

/**
 * Writes a backup file into the database DATABASE_URL points at, which should
 * be a scratch database that has had the migrations run. See
 * docs/runbooks/backup-and-restore.md.
 */
async function main() {
  loadEnvConfig(process.cwd());
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run db:restore -- <path-to-backup.json>");
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not set to a Neon database");

  const backup = JSON.parse(fs.readFileSync(file, "utf-8")) as Backup;
  console.log(`Restoring the backup taken ${backup.takenAt}`);
  const restored = await restoreBackup(db, backup);
  for (const [table, count] of Object.entries(restored)) console.log(`  ${table}: ${count} rows`);

  const problems = await checkRestore(db, backup);
  if (problems.length) {
    console.error("The restore does not match the backup:");
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  if (process.argv.includes("--restore-files")) {
    if(!isStorageConfigured())throw new Error("Connect the private Blob store before restoring files");
    const missing=await restoreFiles(backup,await blobStorage());
    if(missing.length)throw new Error(`File restore incomplete: ${missing.join("; ")}`);
    console.log("Files checked and missing originals restored from their private archive copies.");
  }
  console.log(`Restored, and every table matches. ${backup.files.length} files are expected in storage.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
