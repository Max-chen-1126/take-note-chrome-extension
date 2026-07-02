import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "./ui/Button";

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
    <Button variant="outline" size="sm" icon={copied ? Check : Copy} onClick={handleClick}>
      {copied ? (
        <span role="status" aria-live="polite">
          已複製
        </span>
      ) : (
        "複製"
      )}
    </Button>
  );
}
