import type { ExtractResult } from "../lib/types";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";

const CATEGORY_LABELS: Record<ExtractResult["category"], string> = {
  youtube: "YouTube",
  article: "文章",
  coursera: "Coursera",
};

export interface ExtractCardProps {
  result: ExtractResult;
}

export function ExtractCard({ result }: ExtractCardProps) {
  const { title, text } = result.content;
  const charCount = text.length;

  return (
    <Card>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={title}
        >
          {title}
        </h2>
        <Badge>{CATEGORY_LABELS[result.category] ?? result.category}</Badge>
      </header>

      <p style={{ fontSize: 12, color: "var(--tn-text-muted)", margin: "0 0 8px" }}>
        {charCount} 字
      </p>

      <div
        style={{
          maxHeight: 160,
          overflowY: "auto",
          fontSize: 14,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          border: "1px solid var(--tn-border)",
          borderRadius: "var(--tn-r-control)",
          padding: 12,
          background: "var(--tn-surface-2)",
        }}
      >
        {text}
      </div>
    </Card>
  );
}
