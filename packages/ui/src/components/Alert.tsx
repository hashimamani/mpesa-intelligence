import type { HTMLAttributes, JSX, ReactNode } from "react";
import styles from "./Alert.module.css";

export type AlertTone = "info" | "success" | "warning" | "danger";

const ICONS: Record<AlertTone, string> = {
  info: "i",
  success: "✓",
  warning: "!",
  danger: "✕",
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: AlertTone;
  title: ReactNode;
  description?: ReactNode;
}

/**
 * Copy passed to `title`/`description` should use plain human language
 * ("We noticed something unusual"), not internal terms like "anomaly
 * detected" — see docs/01-prd.md §UX writing (this component doesn't
 * enforce that; the caller does).
 */
export function Alert({ tone = "info", title, description, className, ...rest }: AlertProps): JSX.Element {
  const classes = [styles.alert, styles[tone], className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={classes} role={tone === "danger" ? "alert" : "status"} {...rest}>
      <span className={styles.icon} aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div className={styles.body}>
        <span className={styles.title}>{title}</span>
        {description ? <span className={styles.description}>{description}</span> : null}
      </div>
    </div>
  );
}
