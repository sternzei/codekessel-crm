import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRequestSigner,
  signatureProgress,
} from "@/modules/signatures/progress";

test("empty signature set is not complete", () => {
  const p = signatureProgress([]);
  assert.deepEqual(p, { total: 0, signed: 0, remaining: 0, complete: false });
});

test("single signed signature completes the document", () => {
  const p = signatureProgress([{ signerKind: "participant", status: "signed" }]);
  assert.equal(p.complete, true);
  assert.equal(p.remaining, 0);
});

test("one of two signed → partial, not complete", () => {
  const p = signatureProgress([
    { signerKind: "participant", status: "signed" },
    { signerKind: "employer", status: "pending" },
  ]);
  assert.equal(p.signed, 1);
  assert.equal(p.remaining, 1);
  assert.equal(p.complete, false);
});

test("both signed → complete", () => {
  const p = signatureProgress([
    { signerKind: "participant", status: "signed" },
    { signerKind: "employer", status: "signed" },
  ]);
  assert.equal(p.complete, true);
});

test("a signer with no active request can be requested", () => {
  assert.equal(canRequestSigner([], "participant"), true);
  assert.equal(
    canRequestSigner([{ signerKind: "employer", status: "pending" }], "participant"),
    true,
  );
});

test("a signer already pending or signed cannot be re-requested", () => {
  assert.equal(
    canRequestSigner([{ signerKind: "participant", status: "pending" }], "participant"),
    false,
  );
  assert.equal(
    canRequestSigner([{ signerKind: "participant", status: "signed" }], "participant"),
    false,
  );
});

test("a declined/expired signer can be requested again", () => {
  assert.equal(
    canRequestSigner([{ signerKind: "participant", status: "declined" }], "participant"),
    true,
  );
});
