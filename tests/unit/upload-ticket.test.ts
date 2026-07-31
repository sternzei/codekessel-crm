import { test } from "node:test";
import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";
import { S3StorageAdapter } from "@/modules/storage/s3-driver";
import {
  openUploadTicket,
  sealUploadTicket,
} from "@/modules/participants/upload-ticket";

// When the browser uploads straight to storage, the only thing standing
// between a participant and somebody else's document is that the server signed
// the key. These tests pin that: what a ticket may say, whose link it belongs
// to, and that a presigned URL cannot be widened after it is issued.

const TOKEN = "magic-link-token-for-participant-a";
const OTHER_TOKEN = "magic-link-token-for-participant-b";

const claims = {
  key: "uploads/6f3c1f2a-0000-4000-8000-000000000001.pdf",
  contentType: "application/pdf",
  byteSize: 12_345,
  fileName: "nachweis.pdf",
};

test("a ticket round-trips the grant it was issued for", async () => {
  const sealed = await sealUploadTicket(claims, { token: TOKEN });
  const opened = await openUploadTicket(sealed, { token: TOKEN });
  assert.deepEqual(opened, claims);
});

test("a ticket is worthless on another participant's link", async () => {
  const sealed = await sealUploadTicket(claims, { token: TOKEN });
  assert.equal(await openUploadTicket(sealed, { token: OTHER_TOKEN }), null);
});

test("a tampered ticket is refused", async () => {
  const sealed = await sealUploadTicket(claims, { token: TOKEN });
  const [header, , signature] = sealed.split(".");
  const forged = Buffer.from(
    JSON.stringify({ ...claims, key: "documents/someone-elses-file.pdf" }),
  ).toString("base64url");
  assert.equal(
    await openUploadTicket(`${header}.${forged}.${signature}`, {
      token: TOKEN,
    }),
    null,
  );
});

test("garbage in place of a ticket is refused", async () => {
  assert.equal(await openUploadTicket("not-a-token", { token: TOKEN }), null);
  assert.equal(await openUploadTicket("", { token: TOKEN }), null);
});

const adapter = (options?: { allowPresignedUploads?: boolean }) =>
  new S3StorageAdapter({
    client: new S3Client({
      region: "eu-central-1",
      endpoint: "https://project.supabase.co/storage/v1/s3",
      forcePathStyle: true,
      credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
    }),
    bucket: "documents",
    ...options,
  });

test("a presigned upload binds the bucket, key, type and length", async () => {
  const presign = adapter().presignUpload;
  assert.ok(presign, "the S3 backend should offer direct uploads");

  const result = await presign({
    key: claims.key,
    contentType: claims.contentType,
    byteSize: claims.byteSize,
    expiresInSeconds: 900,
  });

  const url = new URL(result.url);
  assert.equal(url.pathname, `/storage/v1/s3/documents/${claims.key}`);
  assert.equal(result.headers["content-type"], claims.contentType);
  // Both are part of the signature, so neither can be swapped by the browser:
  // a ticket for a 12 KB PDF cannot be redeemed for a gigabyte of anything.
  const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders") ?? "";
  assert.match(signedHeaders, /content-length/);
  assert.match(signedHeaders, /content-type/);
  assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
});

test("direct uploads can be switched off for an unreachable bucket", () => {
  assert.equal(adapter({ allowPresignedUploads: false }).presignUpload, undefined);
});
