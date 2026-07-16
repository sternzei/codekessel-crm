import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSearchFinancials } from "@/modules/register/openregister";

// OpenRegister reports indicator monetary values in CENTS; flat search-row
// fields are already euros. These tests pin the unit handling, sign, and the
// "missing stays missing" guarantee the outreach note + pipeline depend on.

test("indicator net income is converted from cents and keeps a negative loss", () => {
  const fin = extractSearchFinancials({
    company_id: "c1",
    indicators: [{ date: "2024-12-31", net_income: -8_412_345, revenue: 125_000_000 }],
  });
  assert.equal(fin.profitEur, -84123.45);
  assert.equal(fin.revenueEur, 1_250_000);
  assert.equal(fin.fiscalYear, "2024");
  assert.equal(fin.financialsSource, "indicators");
});

test("a positive net income stays positive", () => {
  const fin = extractSearchFinancials({
    company_id: "c2",
    indicators: [{ date: "2023-12-31", net_income: 500_000 }],
  });
  assert.equal(fin.profitEur, 5_000);
  assert.ok(fin.profitEur! > 0);
  assert.equal(fin.fiscalYear, "2023");
});

test("missing financials stay missing — never coerced to 0", () => {
  const fin = extractSearchFinancials({ company_id: "c3" });
  assert.equal(fin.profitEur, null);
  assert.equal(fin.revenueEur, null);
  assert.equal(fin.fiscalYear, null);
  assert.equal(fin.financialsSource, null);
  assert.notEqual(fin.profitEur, 0);
});

test("flat search-row figures are treated as euros, not cents", () => {
  const fin = extractSearchFinancials({
    company_id: "c4",
    net_income: -21_500,
    revenue: 430_000,
    fiscal_year: 2024,
    employees: 12,
  });
  // Not divided by 100 — already euros.
  assert.equal(fin.profitEur, -21_500);
  assert.equal(fin.revenueEur, 430_000);
  assert.equal(fin.fiscalYear, "2024");
  assert.equal(fin.employees, 12);
  assert.equal(fin.financialsSource, "search_row");
});

test("cents-vs-euro: the same nominal value differs by source", () => {
  const fromIndicators = extractSearchFinancials({
    company_id: "c5",
    indicators: [{ date: "2024-01-01", net_income: 100_000 }],
  });
  const fromRow = extractSearchFinancials({
    company_id: "c6",
    net_income: 100_000,
  });
  assert.equal(fromIndicators.profitEur, 1_000); // 100000 cents -> 1000 €
  assert.equal(fromRow.profitEur, 100_000); // already euros
  assert.equal(fromIndicators.financialsSource, "indicators");
  assert.equal(fromRow.financialsSource, "search_row");
});

test("wrong-sign guard: a real break-even 0 is preserved, not dropped", () => {
  const fin = extractSearchFinancials({
    company_id: "c7",
    indicators: [{ date: "2024-06-30", net_income: 0, revenue: 90_000_00 }],
  });
  // Revenue present makes this the indicators branch; a 0 profit is a real
  // value and must survive (not become null and not flip sign).
  assert.equal(fin.profitEur, 0);
  assert.equal(fin.revenueEur, 90_000);
  assert.equal(fin.financialsSource, "indicators");
});
