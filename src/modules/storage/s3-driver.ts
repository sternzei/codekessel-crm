import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { normalizeStorageKey } from "./keys";
import type {
  PresignUploadParams,
  PresignedUpload,
  StorageAdapter,
  StorageKey,
  StoragePutParams,
} from "./types";

export type S3StorageOptions = {
  readonly client: S3Client;
  readonly bucket: string;
  /** Optional key namespace inside the bucket, e.g. "qcg/prod". */
  readonly keyPrefix?: string;
  /**
   * Lets a deployment turn direct browser uploads off even though the backend
   * could do them — useful when the bucket sits behind a network the browser
   * cannot reach.
   */
  readonly allowPresignedUploads?: boolean;
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
    // Assigning the method is what advertises the capability: callers
    // feature-detect it rather than asking a separate question.
    if (options.allowPresignedUploads !== false) {
      this.presignUpload = (params) => this.createPresignedUpload(params);
    }
  }

  presignUpload?: (params: PresignUploadParams) => Promise<PresignedUpload>;

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

  /**
   * A one-object, short-lived PUT URL.
   *
   * Content type and length are part of the signature, so the browser cannot
   * swap either one after the fact: a ticket issued for a 2 MB PDF will not
   * accept 2 GB of anything else. The key is chosen here, never by the client,
   * which is what keeps one upload from landing on another's object.
   *
   * None of that says the bytes are what they claim to be — only the server
   * reading them back can decide that.
   */
  private async createPresignedUpload(
    params: PresignUploadParams,
  ): Promise<PresignedUpload> {
    const key = normalizeStorageKey(params.key);
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        ContentType: params.contentType,
        ContentLength: params.byteSize,
      }),
      {
        expiresIn: params.expiresInSeconds,
        // Both are signed explicitly. Length is the one that matters — without
        // it a ticket for a small file is a licence to upload any amount of
        // data — and type is signed alongside so the object cannot be filed
        // under something it is not.
        signableHeaders: new Set(["content-length", "content-type"]),
      },
    );
    return {
      key,
      url,
      headers: { "content-type": params.contentType },
    };
  }
}
