import type { CSSProperties, JSX } from "react";
import styles from "./Skeleton.module.css";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}

/**
 * A content-shaped loading placeholder — for "we know roughly what's coming,
 * just not the values yet" (e.g. a transaction row). This is not the same as
 * the statement-processing progress stepper, which must reflect real pipeline
 * stages (docs/06-statement-processing-architecture.md) rather than a generic
 * shimmer — don't use Skeleton to fake that kind of progress.
 */
export function Skeleton({ width = "100%", height = 16, radius, className }: SkeletonProps): JSX.Element {
  const style: CSSProperties = {
    width,
    height,
    borderRadius: radius,
  };
  return (
    <span
      className={[styles.skeleton, className ?? ""].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
    />
  );
}
