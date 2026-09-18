"use client";

import { useId, type JSX, type SelectHTMLAttributes } from "react";
import styles from "./Select.module.css";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  helperText?: string;
  errorText?: string;
  /** Keeps the label accessible (screen readers, label-click) but visually
   * hidden — for a dense repeated control (one Select per table row) where
   * a visible label each time would be noisy. */
  hideLabel?: boolean;
}

/** A native `<select>` styled to match Input — options/optgroups are passed
 * as `children`, same as plain HTML, rather than a data-driven API: the
 * caller (e.g. a category picker grouped by top-level category) controls
 * its own `<optgroup>` structure. */
export function Select({ label, helperText, errorText, hideLabel = false, id, className, children, ...rest }: SelectProps): JSX.Element {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const helperId = `${selectId}-helper`;
  const errorId = `${selectId}-error`;
  const hasError = Boolean(errorText);

  return (
    <div className={styles.field}>
      <label htmlFor={selectId} className={hideLabel ? styles.srOnly : styles.label}>
        {label}
      </label>
      <select
        id={selectId}
        className={[styles.select, hasError ? styles.invalid : "", className ?? ""].filter(Boolean).join(" ")}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : helperText ? helperId : undefined}
        {...rest}
      >
        {children}
      </select>
      {hasError ? (
        <span id={errorId} className={styles.errorText} role="alert">
          {errorText}
        </span>
      ) : helperText ? (
        <span id={helperId} className={styles.helperText}>
          {helperText}
        </span>
      ) : null}
    </div>
  );
}
