// Durable object-storage seam. Uploads (participant documents) and generated /
// signed PDFs are legally-relevant DSGVO/AZAV artifacts, so they must NOT live
// on an instance's local disk (ephemeral on containers, unshared across
// replicas). Every writer stores the returned key; every reader streams by key.

/** A stable, driver-agnostic object key, e.g. "uploads/<uuid>.pdf". */
export type StorageKey = string;

export type StoragePutParams = {
  /** Logical key below the storage root, e.g. "documents/<uuid>.pdf". */
  readonly key: StorageKey;
  readonly bytes: Uint8Array;
  /** MIME type persisted as object metadata (S3) when known. */
  readonly contentType?: string;
};

export type PresignUploadParams = {
  readonly key: StorageKey;
  readonly contentType: string;
  /**
   * Exact byte count the browser will send. Signed into the request, so a
   * ticket for a 2 MB file cannot be redeemed for a 2 GB one.
   */
  readonly byteSize: number;
  readonly expiresInSeconds: number;
};

export type PresignedUpload = {
  readonly key: StorageKey;
  readonly url: string;
  /** Must be sent verbatim by the browser, or the signature does not match. */
  readonly headers: Readonly<Record<string, string>>;
};

export interface StorageAdapter {
  /** Persists `bytes` under `key` and returns the canonical stored key. */
  put(params: StoragePutParams): Promise<StorageKey>;
  /** Reads the object at `key`. Rejects when it does not exist. */
  get(key: StorageKey): Promise<Buffer>;
  /** Removes the object at `key`. A missing object is treated as success. */
  delete(key: StorageKey): Promise<void>;
  /**
   * A URL the browser can PUT one object to, bypassing this app entirely.
   *
   * Optional because it is a property of the backend, not of the app: a disk
   * or a Postgres table has no such URL. Callers must handle its absence by
   * falling back to an upload that goes through the server — which is also
   * why nothing here may depend on it being present.
   */
  presignUpload?(params: PresignUploadParams): Promise<PresignedUpload>;
}
