import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUARANTEED_VARIABLES,
  MESSAGE_CHANNELS,
  MESSAGE_TEMPLATE_CATALOG,
  TASK_TYPES_WITH_LANDING_PAGE,
  buildTaskTemplateKey,
  buildTemplateRows,
  listRequiredTemplateKeys,
} from "@/modules/messaging/catalog";
import { listPlaceholders } from "@/modules/messaging/templates";

// renderTemplate throws when a key has no row, so a gap here is a message that
// silently never reaches a participant.
test("every template key the app can request exists in the catalog", () => {
  const defined = new Set(MESSAGE_TEMPLATE_CATALOG.map((entry) => entry.key));
  const missing = listRequiredTemplateKeys().filter((key) => !defined.has(key));
  assert.deepEqual(missing, []);
});

test("the catalog defines no keys the app never requests", () => {
  const required = new Set(listRequiredTemplateKeys());
  const orphans = MESSAGE_TEMPLATE_CATALOG.map((entry) => entry.key).filter(
    (key) => !required.has(key),
  );
  assert.deepEqual(orphans, []);
});

test("expansion produces one row per key and channel", () => {
  const rows = buildTemplateRows();
  assert.equal(rows.length, MESSAGE_TEMPLATE_CATALOG.length * MESSAGE_CHANNELS.length);
  for (const channel of MESSAGE_CHANNELS) {
    const perChannel = rows.filter((row) => row.channel === channel);
    assert.equal(perChannel.length, MESSAGE_TEMPLATE_CATALOG.length);
  }
  assert.ok(rows.every((row) => row.body.trim().length > 0));
  assert.ok(
    rows.every((row) => (row.channel === "email" ? Boolean(row.subject) : true)),
  );
});

// An unresolved placeholder now throws at render time, so a template may only
// reference variables every send path supplies.
test("templates only reference guaranteed variables", () => {
  const allowed = new Set<string>(GUARANTEED_VARIABLES);
  for (const row of buildTemplateRows()) {
    const used = listPlaceholders(`${row.subject ?? ""}\n${row.body}`);
    const unknown = used.filter((name) => !allowed.has(name));
    assert.deepEqual(unknown, [], `${row.key} (${row.channel}) uses ${unknown.join(", ")}`);
  }
});

// {{link}} is only filled for task types that have a /t/[token] page.
test("only task types with a landing page reference a link", () => {
  const linked = new Set(
    TASK_TYPES_WITH_LANDING_PAGE.map((type) => buildTaskTemplateKey(type)),
  );
  const taskTemplates = MESSAGE_TEMPLATE_CATALOG.filter((entry) =>
    entry.key.startsWith("task_"),
  );
  for (const entry of taskTemplates) {
    const usesLink = listPlaceholders(entry.body).includes("link");
    assert.equal(
      usesLink,
      linked.has(entry.key),
      `${entry.key} link usage does not match its landing-page support`,
    );
  }
});

test("no template ships placeholder copy to a recipient", () => {
  for (const row of buildTemplateRows()) {
    assert.ok(
      !/PLATZHALTER/i.test(`${row.subject ?? ""} ${row.body}`),
      `${row.key} (${row.channel}) still contains placeholder copy`,
    );
  }
});
