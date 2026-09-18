import type { JSX } from "react";
import styles from "./BarList.module.css";

export interface BarListItem {
  id: string;
  label: string;
  /** The raw magnitude, used only to compute each bar's relative width. */
  value: number;
  /** Already-formatted for display (e.g. "KSh 1,500.00") — this component
   * never formats money itself, see docs/03-architecture.md's money-
   * handling rule (money is formatted once, at the edge, not respread
   * across every consumer). */
  displayValue: string;
  meta?: string;
}

export interface BarListProps {
  items: BarListItem[];
  tone?: "neutral" | "primary";
}

/**
 * A ranked, direct-labeled horizontal bar list — "biggest categories" and
 * "top merchants" (docs/02's aha moment) are an identity+magnitude ranking,
 * not a chart with axes, so this deliberately skips a categorical color
 * palette entirely (the dataviz skill's §1: sometimes the job doesn't need
 * one) — each bar's own text label carries identity, one tone carries
 * magnitude. See tokens.ts's `color.money.neutral`: ordinary spending
 * doesn't get an alarming color just for being spending.
 */
export function BarList({ items, tone = "neutral" }: BarListProps): JSX.Element {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className={styles.list}>
      {items.map((item) => (
        <div className={styles.row} key={item.id}>
          <div className={styles.rowHead}>
            <span className={styles.label} title={item.label}>
              {item.label}
              {item.meta ? <span className={styles.meta}> · {item.meta}</span> : null}
            </span>
            <span className={styles.value}>{item.displayValue}</span>
          </div>
          <div className={styles.track}>
            <div
              className={`${styles.fill} ${styles[tone]}`}
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
