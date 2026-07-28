import { randomUUID } from "node:crypto";
import type { StorageKey } from "./types";

export type BuildStorageKeyParams = {
  /** Logical folder for the object, e.g. "uploads" | "documents" | "signatures". */
  readonly prefix: string;
  /** File extension without a leading dot, e.g. "pdf" | "png". */
  readonly extension: string;
};

/** Builds a collision-free storage key. User-supplied names never appear in it. */
export function buildStorageKey(params: BuildStorageKeyParams): StorageKey {
  const extension = params.extension.replace(/^\.+/, "");
  const prefix = params.prefix.replace(/^\/+|\/+$/g, "");
  return `${prefix}/${randomUUID()}.${extension}`;
}

/**
 * Canonicalizes a stored value into a storage key. Legacy rows persisted a
 * cwd-relative "var/<prefix>/<file>" path; the key is everything below `var/`,
 * so a leading slash or "var/" prefix is stripped and old + new values resolve
 * to the same object.
 */
export function normalizeStorageKey(key: StorageKey): StorageKey {
  return key.replace(/^\/+/, "").replace(/^var\//, "");
}
