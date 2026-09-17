import type { JSX } from "react";
import type { ProcessingStage } from "@mpesa/types";
import styles from "./ProcessingSteps.module.css";

const STEP_ORDER: ProcessingStage[] = [
  "uploaded",
  "reading_transactions",
  "categorizing",
  "calculating_analytics",
  "generating_insights",
];

const STEP_LABELS: Record<ProcessingStage, string> = {
  uploaded: "Uploaded",
  reading_transactions: "Reading transactions",
  categorizing: "Categorizing transactions",
  calculating_analytics: "Calculating insights",
  generating_insights: "Generating insights",
  complete: "Complete",
};

export interface ProcessingStepsProps {
  /** The pipeline's actual current stage — never a simulated/fake value. See
   * docs/06-statement-processing-architecture.md. */
  currentStage: ProcessingStage;
  /** Set when the job failed while on `currentStage`, to render it as an error rather than "in progress". */
  failed?: boolean;
}

export function ProcessingSteps({ currentStage, failed = false }: ProcessingStepsProps): JSX.Element {
  const currentIndex = currentStage === "complete" ? STEP_ORDER.length : STEP_ORDER.indexOf(currentStage);

  return (
    <ol className={styles.list}>
      {STEP_ORDER.map((stage, index) => {
        const isDone = index < currentIndex;
        const isActive = index === currentIndex;
        const state = isActive && failed ? "failed" : isDone ? "done" : isActive ? "active" : "";

        return (
          <li key={stage} className={[styles.step, state ? styles[state] : ""].filter(Boolean).join(" ")}>
            <span className={styles.marker} aria-hidden="true">
              {state === "done" ? "✓" : state === "failed" ? "✕" : index + 1}
            </span>
            {STEP_LABELS[stage]}
          </li>
        );
      })}
    </ol>
  );
}
