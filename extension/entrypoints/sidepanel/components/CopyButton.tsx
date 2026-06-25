import { useState } from "react";

export interface CopyButtonProps {
  text: string;
}

const COPIED_DURATION_MS = 1500;

export function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_DURATION_MS);
    } catch {
      // Clipboard API unavailable/denied — silently ignore for this slice.
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        fontFamily: "var(--tn-font)",
        fontSize: 14,
        fontWeight: 600,
        padding: "8px 16px",
        borderRadius: "var(--tn-r-control)",
        border: "1px solid var(--tn-primary)",
        background: copied ? "var(--tn-surface)" : "var(--tn-primary)",
        color: copied ? "var(--tn-text)" : "var(--tn-on-primary)",
        cursor: "pointer",
      }}
    >
      {copied ? "已複製" : "⧉ 複製"}
    </button>
  );
}
