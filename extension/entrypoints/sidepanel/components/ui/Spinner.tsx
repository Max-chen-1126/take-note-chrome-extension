import { Loader2 } from "lucide-react";

export interface SpinnerProps {
  size?: number;
  label?: string;
}

export function Spinner({ size = 20, label = "載入中" }: SpinnerProps) {
  return (
    <span style={{ display: "inline-flex", color: "var(--tn-accent)" }}>
      <Loader2 className="tn-spin" size={size} aria-hidden="true" />
      <span className="tn-visually-hidden">{label}</span>
    </span>
  );
}
