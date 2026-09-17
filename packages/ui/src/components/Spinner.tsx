import type { JSX } from "react";
import styles from "./Spinner.module.css";

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

export function Spinner({ size = "md", label = "Loading" }: SpinnerProps): JSX.Element {
  return (
    <span
      role="status"
      aria-label={label}
      className={`${styles.spinner} ${styles[size]}`}
    />
  );
}
