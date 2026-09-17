"use client";

import { useEffect, useRef, type JSX, type ReactNode } from "react";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
}

/**
 * Built on the native <dialog> element specifically for its built-in focus
 * trapping, Escape-to-close, and ::backdrop — accessibility behavior we'd
 * otherwise have to hand-roll. See docs/01-prd.md non-functional requirements
 * (accessibility is not a pre-launch bolt-on).
 */
export function Dialog({ open, title, onClose, children }: DialogProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} onCancel={onClose}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close dialog"
        >
          ✕
        </button>
      </div>
      <div className={styles.body}>{children}</div>
    </dialog>
  );
}
