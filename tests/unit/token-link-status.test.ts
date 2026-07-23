import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveTaskLinkDisplayStatus } from "@/modules/tokens/link-status";

test("a live link is shown as active regardless of past revocations", () => {
  assert.equal(
    deriveTaskLinkDisplayStatus({ hasLiveLink: true, revokedLinkCount: 0 }),
    "active",
  );
  assert.equal(
    deriveTaskLinkDisplayStatus({ hasLiveLink: true, revokedLinkCount: 3 }),
    "active",
  );
});

test("no live link but a prior revoke surfaces as revoked", () => {
  assert.equal(
    deriveTaskLinkDisplayStatus({ hasLiveLink: false, revokedLinkCount: 1 }),
    "revoked",
  );
});

test("no link at all is 'none'", () => {
  assert.equal(
    deriveTaskLinkDisplayStatus({ hasLiveLink: false, revokedLinkCount: 0 }),
    "none",
  );
});
