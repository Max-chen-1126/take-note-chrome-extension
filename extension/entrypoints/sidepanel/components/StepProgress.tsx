import type { CSSProperties } from "react";
import type { StepName } from "../lib/types";
import { STEP_LABELS } from "../lib/types";

const STEP_ORDER: StepName[] = ["structure", "draft", "augment", "verify", "format"];

type StepState = "done" | "active" | "pending";

export interface StepProgressProps {
  active: StepName | null;
  doneSteps: StepName[];
}

function stateFor(step: StepName, active: StepName | null, doneSteps: StepName[]): StepState {
  if (step === active) return "active";
  if (doneSteps.includes(step)) return "done";
  return "pending";
}

const dotStyle = (state: StepState): CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: "var(--tn-r-pill)",
  background: state === "pending" ? "var(--tn-border)" : "var(--tn-primary)",
  opacity: state === "active" ? 1 : state === "done" ? 0.6 : 1,
});

export function StepProgress({ active, doneSteps }: StepProgressProps) {
  return (
    <ol
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        listStyle: "none",
        margin: 0,
        padding: 0,
        fontFamily: "var(--tn-font)",
      }}
    >
      {STEP_ORDER.map((step) => {
        const state = stateFor(step, active, doneSteps);
        return (
          <li
            key={step}
            data-state={state}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: state === "pending" ? "var(--tn-muted)" : "var(--tn-text)",
              fontWeight: state === "active" ? 600 : 400,
              fontSize: 12,
            }}
          >
            <span aria-hidden="true" style={dotStyle(state)} />
            <span>{STEP_LABELS[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}
