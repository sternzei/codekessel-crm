import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCompany,
  normalizeRepresentatives,
  type RawCompany,
} from "@/modules/register/openregister";

// The register returns *historical* officers too — importing someone who left
// years ago would be a bug. These tests pin the current-only + managing-first
// rules that turn a company into a lead.

const rep = (over: Partial<RawCompany["representation"][number]>) => ({
  name: "X",
  role: "PROKURA",
  end_date: null,
  natural_person: { first_name: "X", last_name: "Y", city: "Berlin" },
  ...over,
});

test("drops former officers (those with an end_date)", () => {
  const out = normalizeRepresentatives([
    rep({ name: "Former Boss", role: "DIRECTOR", end_date: "2016-05-23" }),
    rep({ name: "Current Boss", role: "DIRECTOR", end_date: null }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Current Boss");
});

test("managing directors sort before other current roles", () => {
  const out = normalizeRepresentatives([
    rep({ name: "Prok", role: "PROKURA" }),
    rep({ name: "Chef", role: "DIRECTOR" }),
  ]);
  assert.deepEqual(
    out.map((r) => r.name),
    ["Chef", "Prok"],
  );
  assert.equal(out[0].isManagingDirector, true);
  assert.equal(out[1].isManagingDirector, false);
});

test("skips legal-person officers (only natural persons can be a lead)", () => {
  const out = normalizeRepresentatives([
    { name: "Holding GmbH", role: "DIRECTOR", end_date: null } as never,
    rep({ name: "Real Person", role: "DIRECTOR" }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Real Person");
});

test("normalizeCompany maps the wire shape into the flat DTO", () => {
  const raw: RawCompany = {
    id: "DE-HRB-D2601-281581",
    name: { name: "Test GmbH", legal_form: "gmbh" },
    legal_form: "gmbh",
    register: {
      company_id: "DE-HRB-D2601-281581",
      register_number: "281581",
      register_type: "HRB",
      register_court: "München",
    },
    address: { street: "Seidlstraße 3", postal_code: "80335", city: "München" },
    industry_codes: { WZ2025: [{ code: "62.01.0" }] },
    status: "active",
    incorporated_at: "2014-07-25",
    contact: { email: null, phone: null, website_url: "https://x.example" },
    representation: [rep({ name: "Chef", role: "DIRECTOR" })],
  };

  const dto = normalizeCompany(raw);
  assert.equal(dto.companyId, "DE-HRB-D2601-281581");
  assert.equal(dto.name, "Test GmbH");
  assert.equal(dto.registerNumber, "281581");
  assert.equal(dto.registerCourt, "München");
  assert.equal(dto.address.postalCode, "80335");
  assert.equal(dto.industryCode, "62.01.0");
  assert.equal(dto.contact.website, "https://x.example");
  assert.equal(dto.representatives.length, 1);
  assert.equal(dto.representatives[0].isManagingDirector, true);
});
