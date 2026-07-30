import { type SQL, sql } from "drizzle-orm";
import { normalizeStorageKey } from "./keys";
import type { StorageAdapter, StorageKey, StoragePutParams } from "./types";

/**
 * The slice of the Drizzle client this driver needs, so tests can fake it.
 * Rows come back untyped (Drizzle's own `execute` generic does not survive
 * structural assignment); the two columns we read are narrowed at the call site.
 */
export type StorageDbHandle = {
  execute: (query: SQL) => Promise<readonly Record<string, unknown>[]>;
};

/**
 * Ceiling for a single object. Uploads are already capped at 10 MB upstream and
 * generated PDFs are far smaller, so anything near this is a bug — and a bug
 * that would otherwise write a multi-hundred-MB row through WAL into every
 * backup. Fail loudly instead.
 */
export const MAX_OBJECT_BYTES = 32 * 1024 * 1024;

// Blobs in Postgres, selected with STORAGE_DRIVER=db. One durable store and one
// backup for an internal CRM: no bucket credentials, no volume to keep alive,
// and the app tier stays stateless. The trade is that every document travels
// through pg_dump — see docs/PRODUCTION-READINESS.md.
export class DbStorageAdapter implements StorageAdapter {
  private handle: StorageDbHandle | null;

  /**
   * Without an explicit handle the app connection is imported on first use.
   * That import is deliberately dynamic: `@/db/client` opens a pool and reads
   * the validated env at module scope, which must not happen while Next is
   * merely collecting page data at build time.
   */
  constructor(handle?: StorageDbHandle) {
    this.handle = handle ?? null;
  }

  private async db(): Promise<StorageDbHandle> {
    if (!this.handle) this.handle = (await import("@/db/client")).db;
    return this.handle;
  }

  async put(params: StoragePutParams): Promise<StorageKey> {
    if (params.bytes.byteLength > MAX_OBJECT_BYTES) {
      throw new Error(
        `storage object exceeds ${MAX_OBJECT_BYTES} bytes: ${params.bytes.byteLength}`,
      );
    }
    const key = normalizeStorageKey(params.key);
    const bytes = Buffer.from(
      params.bytes.buffer,
      params.bytes.byteOffset,
      params.bytes.byteLength,
    );
    // Upsert rather than insert: a retried write of the same key must succeed,
    // matching the filesystem and S3 drivers.
    const db = await this.db();
    await db.execute(sql`
      insert into storage_objects (key, content_type, byte_size, bytes)
      values (${key}, ${params.contentType ?? null}, ${bytes.byteLength}, ${bytes})
      on conflict (key) do update set
        content_type = excluded.content_type,
        byte_size = excluded.byte_size,
        bytes = excluded.bytes
    `);
    return key;
  }

  async get(key: StorageKey): Promise<Buffer> {
    const db = await this.db();
    const rows = await db.execute(sql`
      select bytes from storage_objects where key = ${normalizeStorageKey(key)} limit 1
    `);
    const bytes = rows[0]?.bytes;
    if (!bytes) throw new Error(`storage object not found: ${key}`);
    return Buffer.from(bytes as Uint8Array);
  }

  async delete(key: StorageKey): Promise<void> {
    const db = await this.db();
    await db.execute(
      sql`delete from storage_objects where key = ${normalizeStorageKey(key)}`,
    );
  }
}
