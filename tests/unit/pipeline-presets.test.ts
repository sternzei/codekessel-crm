import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PIPELINE_PRESETS,
  buildPresetQuery,
  filtersEqual,
  isPresetActive,
  parsePipelineFilter,
  serializePipelineFilter,
  type PipelineFilter,
} from "@/modules/participants/pipeline-filter";

// Parse a query string the same way the pipeline page receives searchParams.
function queryToParams(query: string): Record<string, string | string[]> {
  const params = new URLSearchParams(query);
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  return raw;
}

test("every preset round-trips serialize -> parse to the same filter", () => {
  for (const preset of PIPELINE_PRESETS) {
    const parsed = parsePipelineFilter(queryToParams(buildPresetQuery(preset)));
    assert.ok(
      filtersEqual(preset.filter, parsed),
      `preset ${preset.key} must survive serialize->parse`,
    );
    assert.ok(isPresetActive(preset, parsed), `preset ${preset.key} is active`);
  }
});

test("preset keys and labels are unique", () => {
  const keys = new Set(PIPELINE_PRESETS.map((p) => p.key));
  const labels = new Set(PIPELINE_PRESETS.map((p) => p.label));
  assert.equal(keys.size, PIPELINE_PRESETS.length);
  assert.equal(labels.size, PIPELINE_PRESETS.length);
});

test("serializePipelineFilter is the inverse of parsePipelineFilter", () => {
  const filter: PipelineFilter = {
    statuses: ["new", "interested"],
    consultantId: "c-123",
    source: "openregister",
    phone: "without",
    email: "with",
    search: "müller",
  };
  const parsed = parsePipelineFilter(queryToParams(serializePipelineFilter(filter)));
  assert.ok(filtersEqual(filter, parsed));
});

test("serializePipelineFilter encodes unassigned as consultant=unassigned", () => {
  const query = serializePipelineFilter({ statuses: [], unassigned: true });
  assert.equal(query, "consultant=unassigned");
});

test("isPresetActive distinguishes a non-matching filter", () => {
  const [needsFirstCall] = PIPELINE_PRESETS;
  assert.equal(
    isPresetActive(needsFirstCall, { statuses: ["enrolled"] }),
    false,
  );
});

test("an empty filter matches no preset", () => {
  const empty: PipelineFilter = { statuses: [] };
  assert.equal(
    PIPELINE_PRESETS.some((preset) => isPresetActive(preset, empty)),
    false,
  );
});
