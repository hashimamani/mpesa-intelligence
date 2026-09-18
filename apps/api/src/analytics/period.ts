export const ANALYTICS_VERSION = "mpesa-analytics-v1";

export interface CalendarMonth {
  /** First day of the month, 00:00:00 UTC. */
  periodStart: Date;
  /** Last day of the month, 00:00:00 UTC — for display (SpendingSummaryDTO),
   * not for querying (its own day's transactions would be excluded by a
   * naive `lte` comparison against full datetimes). */
  periodEnd: Date;
  /** First day of the *next* month, 00:00:00 UTC — the correct upper bound
   * for `transactionDate < exclusiveEnd` queries. */
  exclusiveEnd: Date;
}

/** Analytics periods are always full calendar months (docs/17-analytics-engine.md)
 * — a statement's own arbitrary date range (e.g. "01 Aug - 14 Aug") is an
 * extraction-time concept, not how spend is reported back to the user. */
export function calendarMonthOf(date: Date): CalendarMonth {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    periodStart: new Date(Date.UTC(year, month, 1)),
    periodEnd: new Date(Date.UTC(year, month + 1, 0)),
    exclusiveEnd: new Date(Date.UTC(year, month + 1, 1)),
  };
}

/** The `count` calendar months ending with the month containing `from`,
 * oldest first — including months with zero activity, so a trend chart has
 * a continuous x-axis rather than gaps. */
export function monthsBack(count: number, from: Date = new Date()): CalendarMonth[] {
  const months: CalendarMonth[] = [];
  for (let i = count - 1; i >= 0; i--) {
    months.push(calendarMonthOf(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1))));
  }
  return months;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses a "YYYY-MM" query param into its calendar month — returns null on
 * anything else, so the caller can turn that into a 400 rather than a
 * silently wrong date (e.g. `new Date("garbage")` producing Invalid Date). */
export function parseMonthParam(raw: string): CalendarMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, yearStr, monthStr] = match as unknown as [string, string, string];
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (month < 1 || month > 12) return null;
  return calendarMonthOf(new Date(Date.UTC(year, month - 1, 1)));
}
