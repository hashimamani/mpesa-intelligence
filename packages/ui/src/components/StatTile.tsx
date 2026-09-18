import type { JSX, ReactNode } from "react";
import styles from "./StatTile.module.css";

export type StatTileTone = "positive" | "neutral" | "negative";

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** "positive"/"negative" are reserved for a genuinely positive/negative
   * figure (money received, a negative net movement) — ordinary spending
   * stays "neutral", per docs/01-prd.md's "spending is not bad" design
   * principle (tokens.ts's `color.money`). */
  tone?: StatTileTone;
  caption?: ReactNode;
}

/** A single labeled figure — the building block of the dashboard's
 * financial snapshot row (docs/02's "aha moment": total received/sent/
 * fees/net at a glance). Not a chart; see the dataviz skill's guidance
 * that a single headline number doesn't need one. */
export function StatTile({ label, value, tone = "neutral", caption }: StatTileProps): JSX.Element {
  return (
    <div className={styles.tile}>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} ${styles[tone]}`}>{value}</span>
      {caption ? <span className={styles.caption}>{caption}</span> : null}
    </div>
  );
}
