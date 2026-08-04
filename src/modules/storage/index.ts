import path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { DbStorageAdapter, type StorageDbHandle } from "./db-driver";
import { LocalStorageAdapter } from "./local-driver";
import { S3StorageAdapter } from "./s3-driver";
import type { StorageAdapter } from "./types";

export type {
  PresignUploadParams,
  PresignedUpload,
  StorageAdapter,
  StorageKey,
  StoragePutParams,
} from "./types";
export { buildStorageKey, normalizeStorageKey } from "./keys";
export { DbStorageAdapter, MAX_OBJECT_BYTES } from "./db-driver";
export { LocalStorageAdapter } from "./local-driver";
export { S3StorageAdapter } from "./s3-driver";

export type StorageConfig = {
  readonly driver: "local" | "s3" | "db";
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
    readonly allowPresignedUploads?: boolean;
  };
};

export type CreateStorageDeps = {
  /** Injected S3 client (tests). Falls back to one built from the config. */
  readonly s3Client?: S3Client;
  /** Injected Drizzle handle (tests). Falls back to the app connection. */
  readonly dbHandle?: StorageDbHandle;
};

/**
 * Pure driver-selection logic. Kept side-effect-light (only constructs an
 * S3Client when the s3 driver is selected and none is injected) so it is
 * unit-testable.
 */
export function createStorageFromConfig(
  config: StorageConfig,
  deps: CreateStorageDeps = {},
): StorageAdapter {
  if (config.driver === "db") {
    return new DbStorageAdapter(deps.dbHandle);
  }
  if (config.driver === "s3") {
    const s3 = config.s3;
    if (!s3?.bucket) {
      throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    }
    const hasKeys = Boolean(s3.accessKeyId && s3.secretAccessKey);
    // Leaving credentials undefined hands the SDK its default provider chain,
    // which ends up probing the cloud instance metadata address. On a custom
    // endpoint (Supabase, MinIO) there is nothing there to answer, so the call
    // hangs for as long as the platform allows instead of failing. A named
    // endpoint therefore demands named keys.
    if (!hasKeys && s3.endpoint) {
      throw new Error(
        "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when S3_ENDPOINT is set",
      );
    }
    const client =
      deps.s3Client ??
      new S3Client({
        region: s3.region,
        endpoint: s3.endpoint,
        forcePathStyle: s3.forcePathStyle,
        credentials: hasKeys
          ? {
              accessKeyId: s3.accessKeyId as string,
              secretAccessKey: s3.secretAccessKey as string,
            }
          : undefined,
      });
    return new S3StorageAdapter({
      client,
      bucket: s3.bucket,
      keyPrefix: s3.keyPrefix,
      allowPresignedUploads: s3.allowPresignedUploads,
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
      allowPresignedUploads: env.S3_DIRECT_UPLOADS !== "false",
    },
  };
}

let cached: StorageAdapter | null = null;

/** The process-wide storage adapter, built once from env. */
export function getStorage(): StorageAdapter {
  if (!cached) cached = createStorageFromConfig(storageConfigFromEnv());
  return cached;
}

/**
 * Whether a browser can upload to storage without the bytes passing through
 * this app. Worth asking because a serverless host caps request bodies far
 * below what a scanned document needs, so the answer decides which upload
 * form a participant is shown.
 */
export function supportsDirectUpload(): boolean {
  return typeof getStorage().presignUpload === "function";
}
