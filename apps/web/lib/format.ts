import type { Money } from "@mpesa/types";

/** Matches the plain "KSh {amount}" convention already used in
 * app/upload/page.tsx's transaction table — one format, not respread with
 * variations across pages (docs/03-architecture.md's money-handling rule). */
export function formatMoney(money: Money): string {
  return `KSh ${money.amount}`;
}

/** "2026-08-01" -> "Aug 2026". Analytics periods are always calendar
 * months (docs/17-analytics-engine.md), so parsing just the year/month
 * prefix avoids any UTC/local timezone conversion surprise a plain
 * `new Date(periodStart)` display would risk. */
export function formatMonthLabel(periodStartIso: string): string {
  const [year, month] = periodStartIso.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[Number(month) - 1]} ${year}`;
}

/** Short form for chart axis labels, e.g. "Aug" — the year is implied by
 * the chart's own title/context, keeping 6-12 bar labels from crowding. */
export function formatMonthShort(periodStartIso: string): string {
  return formatMonthLabel(periodStartIso).split(" ")[0]!;
}
