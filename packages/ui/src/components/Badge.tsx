import type { HTMLAttributes, JSX } from "react";
import styles from "./Badge.module.css";

export type BadgeTone = "neutral" | "primary" | "success" | "danger" | "warning";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps): JSX.Element {
  const classes = [styles.badge, styles[tone], className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
