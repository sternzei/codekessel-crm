import path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { LocalStorageAdapter } from "./local-driver";
import { S3StorageAdapter } from "./s3-driver";
import type { StorageAdapter } from "./types";

export type { StorageAdapter, StorageKey, StoragePutParams } from "./types";
export { buildStorageKey, normalizeStorageKey } from "./keys";
export { LocalStorageAdapter } from "./local-driver";
export { S3StorageAdapter } from "./s3-driver";

export type StorageConfig = {
  readonly driver: "local" | "s3";
  /** Root directory for the local driver. */
  readonly localRoot: string;
  readonly s3?: {
    readonly bucket?: string;
    readonly region?: string;
    readonly endpoint?: string;
    readonly accessKeyId?: string;
    readonly secretAccessKey?: string;
    readonly forcePathStyle?: boolean;
    readonly keyPrefix?: string;
  };
};

export type CreateStorageDeps = {
  /** Injected S3 client (tests). Falls back to one built from the config. */
  readonly s3Client?: S3Client;
};

/**
 * Pure driver-selection logic. Returns the S3 driver when configured, otherwise
 * the local driver. Kept side-effect-light (only constructs an S3Client when
 * the s3 driver is selected and none is injected) so it is unit-testable.
 */
export function createStorageFromConfig(
  config: StorageConfig,
  deps: CreateStorageDeps = {},
): StorageAdapter {
  if (config.driver === "s3") {
    const s3 = config.s3;
    if (!s3?.bucket) {
      throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    }
    const client =
      deps.s3Client ??
      new S3Client({
        region: s3.region,
        endpoint: s3.endpoint,
        forcePathStyle: s3.forcePathStyle,
        credentials:
          s3.accessKeyId && s3.secretAccessKey
            ? { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey }
            : undefined,
      });
    return new S3StorageAdapter({
      client,
      bucket: s3.bucket,
      keyPrefix: s3.keyPrefix,
    });
  }
  return new LocalStorageAdapter(config.localRoot);
}

function storageConfigFromEnv(): StorageConfig {
  return {
    driver: env.STORAGE_DRIVER,
    localRoot: path.join(process.cwd(), "var"),
    s3: {
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      keyPrefix: env.S3_KEY_PREFIX,
    },
  };
}

let cached: StorageAdapter | null = null;

/** The process-wide storage adapter, built once from env. */
export function getStorage(): StorageAdapter {
  if (!cached) cached = createStorageFromConfig(storageConfigFromEnv());
  return cached;
}
