import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export interface ErrorStateProps {
  title: string;
  message: string;
  hint?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({ title, message, hint, onRetry, retryLabel = "重試" }: ErrorStateProps) {
  return (
    <Card role="alert">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          textAlign: "center",
          padding: "16px 0",
        }}
      >
        <CircleAlert size={24} aria-hidden="true" style={{ color: "var(--tn-danger)" }} />
        <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--tn-text)" }}>{title}</p>
        <p style={{ margin: 0, fontSize: 14, color: "var(--tn-text-muted)" }}>{message}</p>
        {hint && <p style={{ margin: 0, fontSize: 13, color: "var(--tn-text-muted)" }}>{hint}</p>}
        {onRetry && (
          <Button variant="primary" icon={RotateCcw} onClick={onRetry} style={{ marginTop: 8 }}>
            {retryLabel}
          </Button>
        )}
      </div>
    </Card>
  );
}
