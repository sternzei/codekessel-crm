import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { normalizeStorageKey } from "./keys";
import type { StorageAdapter, StorageKey, StoragePutParams } from "./types";

export type S3StorageOptions = {
  readonly client: S3Client;
  readonly bucket: string;
  /** Optional key namespace inside the bucket, e.g. "qcg/prod". */
  readonly keyPrefix?: string;
};

// The S3 body is a streaming object exposing SDK helper methods; we only need
// the byte materializer, so we type just that surface for the mock in tests.
type SdkBody = { transformToByteArray: () => Promise<Uint8Array> } | undefined;

// S3-compatible driver (AWS S3, Cloudflare R2, MinIO via a custom endpoint).
// Durable + shared across replicas. The S3Client is injected so it can be
// mocked in unit tests and configured (endpoint / path-style) for R2/MinIO.
export class S3StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor(options: S3StorageOptions) {
    this.client = options.client;
    this.bucket = options.bucket;
    this.keyPrefix = options.keyPrefix
      ? `${options.keyPrefix.replace(/^\/+|\/+$/g, "")}/`
      : "";
  }

  private objectKey(key: StorageKey): string {
    return `${this.keyPrefix}${normalizeStorageKey(key)}`;
  }

  async put(params: StoragePutParams): Promise<StorageKey> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(params.key),
        Body: params.bytes,
        ContentType: params.contentType,
      }),
    );
    return normalizeStorageKey(params.key);
  }

  async get(key: StorageKey): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    );
    const body = result.Body as SdkBody;
    if (!body) throw new Error(`storage object not found: ${key}`);
    return Buffer.from(await body.transformToByteArray());
  }

  async delete(key: StorageKey): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    );
  }
}
