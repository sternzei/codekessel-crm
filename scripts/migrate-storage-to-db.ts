/**
 * Copies the files an earlier `STORAGE_DRIVER=local` install left under `var/`
 * into the `storage_objects` table, then verifies that every storage key still
 * referenced by a row resolves to an object.
 *
 * Stored keys are driver-agnostic, so no application row changes: a document
 * whose file_path is "uploads/<uuid>.pdf" resolves through whichever driver is
 * configured. Safe to re-run — existing keys are left untouched.
 *
 * Run (owner connection, like the seed):
 *   pnpm storage:migrate            # copy + verify
 *   pnpm storage:migrate --verify   # verify only, write nothing
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { MAX_OBJECT_BYTES } from "@/modules/storage/db-driver";
import { normalizeStorageKey } from "@/modules/storage/keys";

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL is not set");

const verifyOnly = process.argv.includes("--verify");
const storageRoot = path.join(process.cwd(), "var");

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

type FileEntry = { readonly key: string; readonly absolutePath: string };

/** Every file below `var/`, keyed by its path relative to that root. */
async function collectFiles(directory: string): Promise<readonly FileEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const collected: FileEntry[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await collectFiles(absolutePath)));
      continue;
    }
    if (!entry.isFile()) continue;
    const relative = path.relative(storageRoot, absolutePath).split(path.sep).join("/");
    collected.push({ key: normalizeStorageKey(relative), absolutePath });
  }
  return collected;
}

const guessContentType = (key: string): string | null => {
  const extension = key.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return null;
};

async function copyFiles(): Promise<void> {
  const files = await collectFiles(storageRoot);
  if (files.length === 0) {
    console.log(`No files under ${storageRoot} — nothing to copy.`);
    return;
  }
  let copied = 0;
  let skippedExisting = 0;
  for (const file of files) {
    const bytes = await readFile(file.absolutePath);
    if (bytes.byteLength > MAX_OBJECT_BYTES) {
      console.warn(`SKIP (too large, ${bytes.byteLength} bytes): ${file.key}`);
      continue;
    }
    const inserted = await db.execute<{ key: string }>(sql`
      insert into storage_objects (key, content_type, byte_size, bytes)
      values (${file.key}, ${guessContentType(file.key)}, ${bytes.byteLength}, ${bytes})
      on conflict (key) do nothing
      returning key
    `);
    if (inserted.length > 0) copied += 1;
    else skippedExisting += 1;
  }
  console.log(
    `Copied ${copied} file(s); ${skippedExisting} already present out of ${files.length} found.`,
  );
}

/**
 * Lists keys a row still points at that no object satisfies. A clean run is the
 * signal that `var/` can be retired.
 */
async function verifyReferences(): Promise<number> {
  const missing = await db.execute<{ source: string; storage_key: string }>(sql`
    with referenced as (
      select 'documents.file_path' as source, file_path as storage_key
        from documents where file_path is not null
      union all
      select 'documents.signed_file_path', signed_file_path
        from documents where signed_file_path is not null
      union all
      select 'signatures.signature_image_path', signature_image_path
        from signatures where signature_image_path is not null
    )
    select referenced.source, referenced.storage_key
    from referenced
    left join storage_objects
      on storage_objects.key = regexp_replace(referenced.storage_key, '^/*(var/)?', '')
    where storage_objects.key is null
    order by referenced.source, referenced.storage_key
  `);
  if (missing.length === 0) {
    console.log("Verification: every referenced storage key resolves to an object.");
    return 0;
  }
  console.error(`Verification: ${missing.length} referenced key(s) have no object:`);
  for (const row of missing) console.error(`  ${row.source} -> ${row.storage_key}`);
  return missing.length;
}

async function main(): Promise<void> {
  if (!verifyOnly) await copyFiles();
  const missingCount = await verifyReferences();
  await client.end();
  if (missingCount > 0) process.exitCode = 1;
}

// Not top-level await: tsx transpiles a plain .ts script to CJS, which rejects it.
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
