import type { JSX } from "react";
import styles from "./TrendChart.module.css";

export interface TrendPoint {
  id: string;
  /** Short axis label, e.g. "Aug" or "Aug 2026" for a >12 month span. */
  monthLabel: string;
  value: number;
  displayValue: string;
  /** Highlights the most recent/current period — a single accent shade,
   * not a second series (a trend chart is one measure over time; see the
   * dataviz skill's "one axis, no dual-axis" rule — this isn't that, it's
   * just emphasis on one bar). */
  isCurrent?: boolean;
}

export interface TrendChartProps {
  points: TrendPoint[];
}

/**
 * "Spending trend" (docs/02's aha moment) — one measure over discrete
 * monthly buckets, so a bar chart rather than a line (docs/17-analytics-
 * engine.md's trend endpoint already returns zero-value months for any gap,
 * so bars never have to interpolate across a missing point the way a line
 * would). Single series: no legend needed, per the dataviz skill — the
 * section title names what's being measured. Every bar is direct-labeled
 * (few enough points, at most 24, that this stays readable) rather than
 * requiring hover to read a value.
 */
export function TrendChart({ points }: TrendChartProps): JSX.Element {
  const max = Math.max(...points.map((p) => p.value), 1);
  const summary = points.map((p) => `${p.monthLabel}: ${p.displayValue}`).join(", ");

  return (
    <div className={styles.chart} role="img" aria-label={`Spending trend by month: ${summary}`}>
      {points.map((point) => (
        <div className={styles.column} key={point.id} aria-hidden="true">
          <span className={styles.value}>{point.value > 0 ? point.displayValue : ""}</span>
          <div className={styles.barTrack}>
            <div
              className={`${styles.bar} ${point.isCurrent ? styles.barCurrent : ""}`}
              style={{ height: `${Math.max((point.value / max) * 100, point.value > 0 ? 4 : 0)}%` }}
            />
          </div>
          <span className={styles.monthLabel}>{point.monthLabel}</span>
        </div>
      ))}
    </div>
  );
}
