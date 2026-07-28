import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeStorageKey } from "./keys";
import type { StorageAdapter, StorageKey, StoragePutParams } from "./types";

// Default driver: writes under a local root (historically `var/`). Keeps dev +
// single-VM deploys working with zero cloud credentials. NOT durable across
// container replicas — use the S3 driver for multi-instance production.
export class LocalStorageAdapter implements StorageAdapter {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  private resolvePath(key: StorageKey): string {
    const normalized = normalizeStorageKey(key);
    const absolute = path.resolve(this.rootDir, normalized);
    const withinRoot =
      absolute === this.rootDir || absolute.startsWith(this.rootDir + path.sep);
    if (!withinRoot) throw new Error("storage key escapes the storage root");
    return absolute;
  }

  async put(params: StoragePutParams): Promise<StorageKey> {
    const absolute = this.resolvePath(params.key);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, params.bytes);
    return normalizeStorageKey(params.key);
  }

  async get(key: StorageKey): Promise<Buffer> {
    return readFile(this.resolvePath(key));
  }

  async delete(key: StorageKey): Promise<void> {
    try {
      await unlink(this.resolvePath(key));
    } catch (err: unknown) {
      // A missing file is already in the desired end state; re-throw anything else.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
