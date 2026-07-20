import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FEDERAL_STATE,
  applyDiscoveryFilters,
  matchesFederalState,
  matchesLegalForm,
} from "@/modules/register/filters";
import type { RegisterDistressedCompany } from "@/modules/register/types";

// Client-side discovery filters (region + legal form). OpenRegister has no
// confirmed server-side filter for these, so they are applied after fetch.

function company(
  over: Partial<RegisterDistressedCompany> = {},
): RegisterDistressedCompany {
  return {
    companyId: "DE-HRB-1",
    name: "Test GmbH",
    registerNumber: "1",
    registerType: "HRB",
    city: "Stuttgart",
    postalCode: "70173",
    legalForm: "gmbh",
    profitEur: -1000,
    revenueEur: 100000,
    fiscalYear: "2024",
    employees: 20,
    financialsSource: "search_row",
    ...over,
  };
}

test("the configured default region is Baden-Württemberg", () => {
  assert.equal(DEFAULT_FEDERAL_STATE, "baden-wuerttemberg");
});

test("matchesFederalState maps postal-code prefixes to states", () => {
  assert.equal(matchesFederalState("70173", "baden-wuerttemberg"), true); // Stuttgart
  assert.equal(matchesFederalState("79098", "baden-wuerttemberg"), true); // Freiburg
  assert.equal(matchesFederalState("80331", "baden-wuerttemberg"), false); // München (Bayern)
  assert.equal(matchesFederalState("10115", "baden-wuerttemberg"), false); // Berlin
});

test("an empty federal state means all regions", () => {
  assert.equal(matchesFederalState("80331", ""), true);
  assert.equal(matchesFederalState(null, ""), true);
});

test("a company without a postal code is excluded when a state is chosen", () => {
  assert.equal(matchesFederalState(null, "baden-wuerttemberg"), false);
});

test("an unconfigured state does not over-filter", () => {
  assert.equal(matchesFederalState("70173", "atlantis"), true);
});

test("matchesLegalForm is case-insensitive and empty = all", () => {
  assert.equal(matchesLegalForm("GmbH", ["gmbh"]), true);
  assert.equal(matchesLegalForm("ug", ["gmbh", "ug"]), true);
  assert.equal(matchesLegalForm("ag", ["gmbh"]), false);
  assert.equal(matchesLegalForm("gmbh", []), true);
  assert.equal(matchesLegalForm(null, ["gmbh"]), false);
});

test("applyDiscoveryFilters narrows by region and legal form together", () => {
  const companies = [
    company({ companyId: "bw-gmbh", postalCode: "70173", legalForm: "gmbh" }),
    company({ companyId: "by-gmbh", postalCode: "80331", legalForm: "gmbh" }),
    company({ companyId: "bw-ug", postalCode: "70173", legalForm: "ug" }),
  ];
  const out = applyDiscoveryFilters(companies, {
    federalState: "baden-wuerttemberg",
    legalForms: ["gmbh"],
  });
  assert.deepEqual(out.map((c) => c.companyId), ["bw-gmbh"]);
});

test("applyDiscoveryFilters with no criteria keeps everything", () => {
  const companies = [company(), company({ companyId: "x", postalCode: "80331" })];
  const out = applyDiscoveryFilters(companies, {});
  assert.equal(out.length, 2);
});
