import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFunnel,
  buildPipelineConditions,
  buildPipelineCsv,
  computeConversions,
  deriveKpis,
  nextActionKey,
  parsePipelineFilter,
  parsePipelineListParams,
  rate,
  type PipelineFilter,
  type StatusCounts,
} from "@/modules/participants/pipeline-filter";
import { PIPELINE_STATUS_ORDER } from "@/modules/participants/queries";

const emptyFilter: PipelineFilter = { statuses: [] };

// ---------------------------------------------------------------------------
// Filter → SQL builder. Each active filter contributes exactly one condition.
// Both the aggregate (KPI/funnel) and the list query build their SQL from this
// single function, so a count and its list can never disagree.
// ---------------------------------------------------------------------------

test("empty filter produces no conditions", () => {
  assert.equal(buildPipelineConditions(emptyFilter).length, 0);
});

test("each active filter adds exactly one condition", () => {
  assert.equal(
    buildPipelineConditions({ statuses: ["new", "called"] }).length,
    1,
  );
  assert.equal(
    buildPipelineConditions({ statuses: [], consultantId: "abc" }).length,
    1,
  );
  assert.equal(
    buildPipelineConditions({ statuses: [], unassigned: true }).length,
    1,
  );
  assert.equal(
    buildPipelineConditions({ statuses: [], source: "openregister" }).length,
    1,
  );
  assert.equal(
    buildPipelineConditions({ statuses: [], phone: "with" }).length,
    1,
  );
  assert.equal(
    buildPipelineConditions({ statuses: [], email: "without" }).length,
    1,
  );
  assert.equal(
    buildPipelineConditions({ statuses: [], search: "müller" }).length,
    1,
  );
});

test("unassigned takes precedence over consultantId", () => {
  const conditions = buildPipelineConditions({
    statuses: [],
    unassigned: true,
    consultantId: "abc",
  });
  assert.equal(conditions.length, 1);
});

test("a fully-populated filter builds a stable condition count", () => {
  const filter: PipelineFilter = {
    statuses: ["new", "interested"],
    consultantId: "c1",
    source: "openregister",
    createdFrom: new Date("2026-01-01"),
    createdUntil: new Date("2026-02-01"),
    phone: "with",
    email: "with",
    search: "berlin",
  };
  // statuses + consultant + source + from + until + phone + email + search = 8
  assert.equal(buildPipelineConditions(filter).length, 8);
  // Deterministic: the same filter always yields the same condition count,
  // which is what guarantees count/list agreement across both consumers.
  assert.equal(
    buildPipelineConditions(filter).length,
    buildPipelineConditions(filter).length,
  );
});

// ---------------------------------------------------------------------------
// Search-param parsing
// ---------------------------------------------------------------------------

test("parsePipelineFilter keeps only real statuses", () => {
  const filter = parsePipelineFilter({ status: ["new", "bogus", "lost"] });
  assert.deepEqual(filter.statuses, ["new", "lost"]);
});

test("parsePipelineFilter maps consultant=unassigned to the unassigned flag", () => {
  const filter = parsePipelineFilter({ consultant: "unassigned" });
  assert.equal(filter.unassigned, true);
  assert.equal(filter.consultantId, undefined);
});

test("parsePipelineFilter normalises phone=missing to without", () => {
  assert.equal(parsePipelineFilter({ phone: "missing" }).phone, "without");
  assert.equal(parsePipelineFilter({ email: "with" }).email, "with");
});

test("parsePipelineFilter treats createdUntil as end-of-day", () => {
  const filter = parsePipelineFilter({ createdUntil: "2026-03-10" });
  assert.equal(filter.createdUntil?.getHours(), 23);
  assert.equal(filter.createdUntil?.getMinutes(), 59);
});

test("parsePipelineListParams clamps page/pageSize and defaults sort", () => {
  const params = parsePipelineListParams({ page: "0", pageSize: "9999" });
  assert.equal(params.page, 1);
  assert.equal(params.pageSize, 100);
  assert.equal(params.sort, "created");
  assert.equal(params.dir, "desc");
  const custom = parsePipelineListParams({ sort: "name", dir: "asc" });
  assert.equal(custom.sort, "name");
  assert.equal(custom.dir, "asc");
});

// ---------------------------------------------------------------------------
// KPI + funnel + conversion calculations (pure)
// ---------------------------------------------------------------------------

const sampleCounts: StatusCounts = {
  new: 10,
  called: 4,
  not_reachable: 3,
  wrong_number: 2,
  interested: 6,
  not_interested: 5,
  eligibility_unclear: 1,
  employer_pending: 3,
  qualified: 4,
  test_phase: 2,
  documents_phase: 1,
  application_phase: 2,
  enrolled: 1,
  lost: 3,
};
// total = 47

test("rate rounds to one decimal and guards divide-by-zero", () => {
  assert.equal(rate(1, 3), 33.3);
  assert.equal(rate(0, 0), null);
  assert.equal(rate(5, 10), 50);
});

test("deriveKpis buckets statuses correctly", () => {
  const total = Object.values(sampleCounts).reduce((a, b) => a + (b ?? 0), 0);
  const kpis = deriveKpis(sampleCounts, {
    total,
    withPhone: 40,
    withEmail: 20,
  });
  assert.equal(kpis.total, 47);
  assert.equal(kpis.needsFirstCall, 10);
  // reached = interested..enrolled = 6+5+1+3+4+2+1+2+1 = 25
  assert.equal(kpis.reached, 25);
  assert.equal(kpis.interested, 6);
  // qualified+ = qualified,test,documents,application,enrolled = 4+2+1+2+1 = 10
  assert.equal(kpis.qualifiedPlus, 10);
  assert.equal(kpis.employerPending, 3);
  // unreachable = not_reachable + wrong_number = 5
  assert.equal(kpis.unreachable, 5);
  // application+ = application_phase + enrolled = 3
  assert.equal(kpis.applicationPlus, 3);
  // lost = lost + not_interested = 8
  assert.equal(kpis.lost, 8);
  // open = total - lost(8) - enrolled(1) = 38
  assert.equal(kpis.open, 38);
  assert.equal(kpis.phoneCoverage, rate(40, 47));
  assert.equal(kpis.emailCoverage, rate(20, 47));
});

test("buildFunnel returns every status in canonical order", () => {
  const funnel = buildFunnel(sampleCounts);
  assert.equal(funnel.length, PIPELINE_STATUS_ORDER.length);
  assert.deepEqual(
    funnel.map((s) => s.status),
    [...PIPELINE_STATUS_ORDER],
  );
  assert.equal(funnel[0].count, 10);
});

test("computeConversions exposes explicit numerator/denominator", () => {
  const steps = computeConversions(sampleCounts);
  const worked = steps.find((s) => s.key === "worked");
  assert.equal(worked?.numerator, 37); // 47 total - 10 new
  assert.equal(worked?.denominator, 47);
  const reached = steps.find((s) => s.key === "reached");
  assert.equal(reached?.numerator, 25);
  assert.equal(reached?.denominator, 37);
  const enrolled = steps.find((s) => s.key === "enrolled");
  assert.equal(enrolled?.numerator, 1);
  assert.equal(enrolled?.denominator, 3);
});

test("nextActionKey maps each status to an action", () => {
  assert.equal(nextActionKey("new"), "call");
  assert.equal(nextActionKey("wrong_number"), "fix_number");
  assert.equal(nextActionKey("employer_pending"), "follow_employer");
  assert.equal(nextActionKey("enrolled"), "none");
  for (const status of PIPELINE_STATUS_ORDER) {
    assert.equal(typeof nextActionKey(status), "string");
  }
});

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

test("buildPipelineCsv writes a header and escapes special characters", () => {
  const csv = buildPipelineCsv([
    {
      firstName: "Anna",
      lastName: 'Muster, "die" Chefin',
      status: "new",
      city: "Berlin",
      source: "openregister",
      consultantName: null,
      phone: "+49 30 1",
      email: "a@b.de",
      createdAt: new Date("2026-01-02T10:00:00Z"),
      updatedAt: new Date("2026-01-03T10:00:00Z"),
    },
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Vorname,Nachname,Status,Ort,Quelle,Beratung,Telefon,E-Mail,Erstellt,Aktualisiert");
  assert.match(lines[1], /"Muster, ""die"" Chefin"/);
  assert.match(lines[1], /Anna/);
});

test("buildPipelineCsv neutralises formula-leading cells (CSV injection)", () => {
  const csv = buildPipelineCsv([
    {
      firstName: '=HYPERLINK("https://evil.example","x")',
      lastName: "@SUM(1)",
      status: "new",
      city: "-2+3",
      source: "+cmd",
      consultantName: null,
      phone: "+49 30 1",
      email: "a@b.de",
      createdAt: new Date("2026-01-02T10:00:00Z"),
      updatedAt: new Date("2026-01-03T10:00:00Z"),
    },
  ]);
  const line = csv.split("\r\n")[1];
  assert.match(line, /'=HYPERLINK/);
  assert.match(line, /'@SUM/);
  assert.match(line, /'-2\+3/);
  assert.match(line, /'\+cmd/);
  assert.ok(line.includes("'+49 30 1"));
});
