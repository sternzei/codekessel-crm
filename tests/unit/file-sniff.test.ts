import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionFor, sniffUploadType } from "@/lib/file-sniff";

// 1x1 transparent PNG (starts with the 8-byte PNG magic).
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("detects a real PDF", () => {
  assert.equal(sniffUploadType(Buffer.from("%PDF-1.7\n...")), "application/pdf");
});

test("detects a real PNG", () => {
  assert.equal(sniffUploadType(PNG_1PX), "image/png");
});

test("detects a real JPEG", () => {
  assert.equal(
    sniffUploadType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00])),
    "image/jpeg",
  );
});

test("rejects an unknown or spoofed type from its leading bytes", () => {
  // HTML masquerading as application/pdf by MIME/name — bytes give it away.
  assert.equal(sniffUploadType(Buffer.from("<html><body>x</body></html>")), null);
  assert.equal(sniffUploadType(Uint8Array.from([0x00, 0x01, 0x02, 0x03])), null);
});

test("rejects a file shorter than the magic signature", () => {
  assert.equal(sniffUploadType(Uint8Array.from([0x25, 0x50])), null); // "%P" only
});

test("extensionFor maps sniffed types to safe on-disk extensions", () => {
  assert.equal(extensionFor("application/pdf"), "pdf");
  assert.equal(extensionFor("image/png"), "png");
  assert.equal(extensionFor("image/jpeg"), "jpg");
});
