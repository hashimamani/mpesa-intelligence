import type { TableHTMLAttributes, JSX } from "react";
import styles from "./Table.module.css";

export type TableProps = TableHTMLAttributes<HTMLTableElement>;

/**
 * A thin, scrollable wrapper around a semantic `<table>` — deliberately not a
 * generic data-grid with column configs, since there's no real transaction/
 * revenue data to shape it around yet (that lands at Stage 8/9/12). Use plain
 * `<thead>`/`<tbody>`/`<tr>` children; apply `tableStyles.numeric` to `<td>`s
 * holding monetary values so figures align right with tabular-nums.
 */
export function Table({ className, children, ...rest }: TableProps): JSX.Element {
  return (
    <div className={styles.wrapper}>
      <table className={[styles.table, className ?? ""].filter(Boolean).join(" ")} {...rest}>
        {children}
      </table>
    </div>
  );
}

export const tableStyles = { numeric: styles.numeric };
