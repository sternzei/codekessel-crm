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

export interface StorageAdapter {
  /** Persists `bytes` under `key` and returns the canonical stored key. */
  put(params: StoragePutParams): Promise<StorageKey>;
  /** Reads the object at `key`. Rejects when it does not exist. */
  get(key: StorageKey): Promise<Buffer>;
  /** Removes the object at `key`. A missing object is treated as success. */
  delete(key: StorageKey): Promise<void>;
}
