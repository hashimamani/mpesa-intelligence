import type { JSX, ReactNode } from "react";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

/**
 * `title`/`description` must be specific to what's actually empty and what to
 * do about it ("No statement analyzed yet. Upload your first statement to see
 * your spending breakdown.") — never a generic "No data." See docs/01-prd.md
 * §Empty states.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className={styles.emptyState}>
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={styles.title}>{title}</span>
      {description ? <span className={styles.description}>{description}</span> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
