import type { HTMLAttributes, JSX } from "react";
import styles from "./Card.module.css";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: "sm" | "md" | "lg";
  interactive?: boolean;
}

export function Card({
  padding = "md",
  interactive = false,
  className,
  children,
  ...rest
}: CardProps): JSX.Element {
  const paddingClass = padding === "md" ? "" : styles[`padded-${padding}`];
  const classes = [styles.card, paddingClass, interactive ? styles.interactive : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
