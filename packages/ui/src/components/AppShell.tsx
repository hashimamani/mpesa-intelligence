import type { JSX, ReactNode } from "react";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  brand: ReactNode;
  nav?: ReactNode;
  side?: ReactNode;
  children: ReactNode;
}

/**
 * A minimal top-nav shell shared by the consumer and business surfaces —
 * navigation *content* (real routes, role-aware items) is wired in at
 * Stage 4 (auth) and Stage 12 (business), not here. This only establishes
 * the structural layout and how it responds at small widths.
 */
export function AppShell({ brand, nav, side, children }: AppShellProps): JSX.Element {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>{brand}</span>
        {nav ? <nav className={styles.nav}>{nav}</nav> : null}
        {side ? <div className={styles.side}>{side}</div> : null}
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
