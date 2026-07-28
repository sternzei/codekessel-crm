import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  LocalStorageAdapter,
  S3StorageAdapter,
  buildStorageKey,
  createStorageFromConfig,
  normalizeStorageKey,
} from "@/modules/storage";

async function makeTempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "qcg-storage-"));
}

// --- key helpers -----------------------------------------------------------

test("buildStorageKey produces a prefixed, extension-suffixed, collision-free key", () => {
  const key = buildStorageKey({ prefix: "uploads", extension: "pdf" });
  assert.match(key, /^uploads\/[0-9a-f-]{36}\.pdf$/);
  const other = buildStorageKey({ prefix: "uploads", extension: "pdf" });
  assert.notEqual(key, other);
});

test("normalizeStorageKey strips a legacy var/ prefix and leading slashes", () => {
  assert.equal(normalizeStorageKey("var/uploads/x.pdf"), "uploads/x.pdf");
  assert.equal(normalizeStorageKey("/uploads/x.pdf"), "uploads/x.pdf");
  assert.equal(normalizeStorageKey("uploads/x.pdf"), "uploads/x.pdf");
});

// --- local driver ----------------------------------------------------------

test("LocalStorageAdapter put/get/delete round-trips bytes", async () => {
  const root = await makeTempRoot();
  const adapter = new LocalStorageAdapter(root);
  const inputBytes = Buffer.from("hello pdf");
  const key = await adapter.put({ key: "documents/a.pdf", bytes: inputBytes });
  assert.equal(key, "documents/a.pdf");
  const actualBytes = await adapter.get(key);
  assert.deepEqual(actualBytes, inputBytes);
  await adapter.delete(key);
  await assert.rejects(() => adapter.get(key));
  await rm(root, { recursive: true, force: true });
});

test("LocalStorageAdapter resolves a legacy var/-prefixed key to the same object", async () => {
  const root = await makeTempRoot();
  const adapter = new LocalStorageAdapter(root);
  await adapter.put({ key: "uploads/legacy.pdf", bytes: Buffer.from("x") });
  // A row persisted before the storage abstraction stored "var/uploads/...".
  const actualBytes = await adapter.get("var/uploads/legacy.pdf");
  assert.deepEqual(actualBytes, Buffer.from("x"));
  await rm(root, { recursive: true, force: true });
});

test("LocalStorageAdapter rejects a key that escapes the storage root", async () => {
  const root = await makeTempRoot();
  const adapter = new LocalStorageAdapter(root);
  await assert.rejects(
    () => adapter.get("../../etc/passwd"),
    /escapes the storage root/,
  );
  await rm(root, { recursive: true, force: true });
});

test("LocalStorageAdapter delete of a missing key is a no-op", async () => {
  const root = await makeTempRoot();
  const adapter = new LocalStorageAdapter(root);
  await assert.doesNotReject(() => adapter.delete("documents/missing.pdf"));
  await rm(root, { recursive: true, force: true });
});

// --- driver selection -------------------------------------------------------

test("createStorageFromConfig returns the local driver by default", () => {
  const adapter = createStorageFromConfig({ driver: "local", localRoot: "/tmp/x" });
  assert.ok(adapter instanceof LocalStorageAdapter);
});

test("createStorageFromConfig returns the s3 driver when selected", () => {
  const mockClient = { send: async () => ({}) } as unknown as S3Client;
  const adapter = createStorageFromConfig(
    { driver: "s3", localRoot: "/tmp/x", s3: { bucket: "qcg-docs" } },
    { s3Client: mockClient },
  );
  assert.ok(adapter instanceof S3StorageAdapter);
});

test("createStorageFromConfig throws when s3 is selected without a bucket", () => {
  assert.throws(
    () => createStorageFromConfig({ driver: "s3", localRoot: "/tmp/x", s3: {} }),
    /S3_BUCKET is required/,
  );
});

// --- s3 driver (mocked client, no network) ----------------------------------

type SentCommand = PutObjectCommand | GetObjectCommand | DeleteObjectCommand;

function makeMockS3(getBytes: Uint8Array) {
  const sent: SentCommand[] = [];
  const client = {
    send: async (command: SentCommand) => {
      sent.push(command);
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToByteArray: async () => getBytes } };
      }
      return {};
    },
  } as unknown as S3Client;
  return { client, sent };
}

test("S3StorageAdapter.put issues a PutObjectCommand with the prefixed key", async () => {
  const { client, sent } = makeMockS3(new Uint8Array());
  const adapter = new S3StorageAdapter({ client, bucket: "b", keyPrefix: "qcg/prod" });
  const returnedKey = await adapter.put({
    key: "documents/a.pdf",
    bytes: Buffer.from("pdf"),
    contentType: "application/pdf",
  });
  assert.equal(returnedKey, "documents/a.pdf");
  const [command] = sent;
  assert.ok(command instanceof PutObjectCommand);
  assert.equal(command.input.Bucket, "b");
  assert.equal(command.input.Key, "qcg/prod/documents/a.pdf");
  assert.equal(command.input.ContentType, "application/pdf");
});

test("S3StorageAdapter.get materializes the body stream into a Buffer", async () => {
  const expectedBytes = new Uint8Array([1, 2, 3]);
  const { client, sent } = makeMockS3(expectedBytes);
  const adapter = new S3StorageAdapter({ client, bucket: "b" });
  const actualBytes = await adapter.get("var/documents/a.pdf");
  assert.deepEqual(actualBytes, Buffer.from(expectedBytes));
  const [command] = sent;
  assert.ok(command instanceof GetObjectCommand);
  // Legacy var/ prefix is normalized away before hitting the bucket.
  assert.equal(command.input.Key, "documents/a.pdf");
});

test("S3StorageAdapter.delete issues a DeleteObjectCommand", async () => {
  const { client, sent } = makeMockS3(new Uint8Array());
  const adapter = new S3StorageAdapter({ client, bucket: "b" });
  await adapter.delete("documents/a.pdf");
  const [command] = sent;
  assert.ok(command instanceof DeleteObjectCommand);
  assert.equal(command.input.Key, "documents/a.pdf");
});
