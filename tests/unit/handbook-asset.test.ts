import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveHandbookAsset } from "@/modules/handbook/assets";
import { prepareHandbookHtml } from "@/modules/handbook/html";

const withFixture = async (
  run: (root: string) => Promise<void>,
): Promise<void> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qcg-handbook-"));
  try {
    await mkdir(path.join(root, "assets", "webp"), { recursive: true });
    await writeFile(path.join(root, "index.html"), "<html><head></head></html>");
    await writeFile(path.join(root, "assets", "webp", "pipeline.webp"), "RIFF");
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("empty segments serve the handbook index", async () => {
  await withFixture(async (root) => {
    const asset = resolveHandbookAsset({ root, segments: [] });
    assert.ok(asset);
    assert.equal(asset.isHtml, true);
    assert.equal(asset.contentType, "text/html; charset=utf-8");
    assert.equal(asset.absolutePath, path.join(root, "index.html"));
  });
});

test("undefined segments serve the handbook index", async () => {
  await withFixture(async (root) => {
    const asset = resolveHandbookAsset({ root });
    assert.ok(asset);
    assert.equal(asset.absolutePath, path.join(root, "index.html"));
  });
});

test("nested screenshot paths stay inside the handbook root", async () => {
  await withFixture(async (root) => {
    const asset = resolveHandbookAsset({
      root,
      segments: ["assets", "webp", "pipeline.webp"],
    });
    assert.ok(asset);
    assert.equal(asset.isHtml, false);
    assert.equal(asset.contentType, "image/webp");
    assert.equal(
      asset.absolutePath,
      path.join(root, "assets", "webp", "pipeline.webp"),
    );
  });
});

test("path traversal and unknown files are rejected", async () => {
  await withFixture(async (root) => {
    assert.equal(
      resolveHandbookAsset({ root, segments: ["..", "package.json"] }),
      null,
    );
    assert.equal(
      resolveHandbookAsset({
        root,
        segments: ["assets", "..", "..", "package.json"],
      }),
      null,
    );
    assert.equal(
      resolveHandbookAsset({ root, segments: ["missing.webp"] }),
      null,
    );
    assert.equal(
      resolveHandbookAsset({ root, segments: ["assets", "webp", "nope.webp"] }),
      null,
    );
    assert.equal(
      resolveHandbookAsset({ root, segments: ["index.js"] }),
      null,
    );
  });
});

test("prepareHandbookHtml injects a base href once", () => {
  const source = "<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\" />";
  const prepared = prepareHandbookHtml(source, "/hilfe/academy/");
  assert.match(prepared, /<head>\n<base href="\/hilfe\/academy\/">/);
  const twice = prepareHandbookHtml(prepared, "/hilfe/academy/");
  assert.equal(twice, prepared);
});
