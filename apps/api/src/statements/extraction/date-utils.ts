const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function monthNameToIndex(name: string): number | null {
  const key = name.slice(0, 3).toLowerCase();
  return key in MONTHS ? MONTHS[key]! : null;
}

const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const SLASH_DATETIME = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;
const TEXT_DATETIME = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;

/**
 * Parses a "completion time" cell in whichever of the layouts real M-Pesa
 * statements have been seen to use: ISO (`2026-08-01 09:15:22`), slash-dated
 * (`01/08/2026 09:15:22`), or month-name (`01 Aug 2026 09:15:22`). Returns
 * null rather than guessing when none match, so the caller can flag the row
 * for review instead of silently inventing a date.
 */
export function parseFlexibleDateTime(raw: string): Date | null {
  const text = raw.trim();

  let match = ISO_DATETIME.exec(text);
  if (match) {
    const [, year, month, day, hour, minute, second] = match as unknown as [
      string, string, string, string, string, string, string,
    ];
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  }

  match = SLASH_DATETIME.exec(text);
  if (match) {
    const [, day, month, year, hour, minute, second] = match as unknown as [
      string, string, string, string, string, string, string,
    ];
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  }

  match = TEXT_DATETIME.exec(text);
  if (match) {
    const [, day, monthName, year, hour, minute, second] = match as unknown as [
      string, string, string, string, string, string, string,
    ];
    const monthIndex = monthNameToIndex(monthName);
    if (monthIndex === null) return null;
    return new Date(Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute), Number(second)));
  }

  return null;
}
