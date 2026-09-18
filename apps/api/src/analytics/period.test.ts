import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarMonthOf, formatDateOnly, monthsBack, parseMonthParam } from "./period";

test("calendarMonthOf: resolves to the first and last day of that UTC month, plus the next month's first day", () => {
  const month = calendarMonthOf(new Date(Date.UTC(2026, 7, 15, 13, 45))); // 15 Aug 2026
  assert.equal(formatDateOnly(month.periodStart), "2026-08-01");
  assert.equal(formatDateOnly(month.periodEnd), "2026-08-31");
  assert.equal(formatDateOnly(month.exclusiveEnd), "2026-09-01");
});

test("calendarMonthOf: handles a 30-day month and a leap February correctly", () => {
  const april = calendarMonthOf(new Date(Date.UTC(2026, 3, 5)));
  assert.equal(formatDateOnly(april.periodEnd), "2026-04-30");

  const leapFeb = calendarMonthOf(new Date(Date.UTC(2028, 1, 10))); // 2028 is a leap year
  assert.equal(formatDateOnly(leapFeb.periodEnd), "2028-02-29");

  const nonLeapFeb = calendarMonthOf(new Date(Date.UTC(2026, 1, 10)));
  assert.equal(formatDateOnly(nonLeapFeb.periodEnd), "2026-02-28");
});

test("calendarMonthOf: December rolls exclusiveEnd into January of the next year", () => {
  const december = calendarMonthOf(new Date(Date.UTC(2026, 11, 25)));
  assert.equal(formatDateOnly(december.periodEnd), "2026-12-31");
  assert.equal(formatDateOnly(december.exclusiveEnd), "2027-01-01");
});

test("monthsBack: returns `count` consecutive months, oldest first, ending at the given month", () => {
  const months = monthsBack(3, new Date(Date.UTC(2026, 7, 15))); // Aug 2026
  assert.equal(months.length, 3);
  assert.equal(formatDateOnly(months[0]!.periodStart), "2026-06-01");
  assert.equal(formatDateOnly(months[1]!.periodStart), "2026-07-01");
  assert.equal(formatDateOnly(months[2]!.periodStart), "2026-08-01");
});

test("monthsBack: crosses a year boundary correctly", () => {
  const months = monthsBack(3, new Date(Date.UTC(2026, 1, 1))); // Feb 2026
  assert.deepEqual(months.map((m) => formatDateOnly(m.periodStart)), ["2025-12-01", "2026-01-01", "2026-02-01"]);
});

test("parseMonthParam: parses a well-formed YYYY-MM string", () => {
  const parsed = parseMonthParam("2026-08");
  assert.ok(parsed);
  assert.equal(formatDateOnly(parsed!.periodStart), "2026-08-01");
  assert.equal(formatDateOnly(parsed!.periodEnd), "2026-08-31");
});

test("parseMonthParam: rejects malformed input rather than silently producing an Invalid Date", () => {
  assert.equal(parseMonthParam("not-a-month"), null);
  assert.equal(parseMonthParam("2026-13"), null); // no month 13
  assert.equal(parseMonthParam("2026-00"), null); // no month 0
  assert.equal(parseMonthParam("08-2026"), null); // wrong order
  assert.equal(parseMonthParam("2026-8"), null); // must be zero-padded
});
