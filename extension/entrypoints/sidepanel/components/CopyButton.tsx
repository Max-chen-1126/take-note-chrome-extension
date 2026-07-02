import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "./ui/Button";

export interface CopyButtonProps {
  text: string;
}

const COPIED_DURATION_MS = 1500;
const COPIED_ANNOUNCEMENT = "已複製內容";

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
    <>
      <Button variant="outline" size="sm" icon={copied ? Check : Copy} onClick={handleClick}>
        {copied ? "已複製" : "複製"}
      </Button>
      <span role="status" aria-live="polite" className="tn-visually-hidden">
        {copied ? COPIED_ANNOUNCEMENT : ""}
      </span>
    </>
  );
}
