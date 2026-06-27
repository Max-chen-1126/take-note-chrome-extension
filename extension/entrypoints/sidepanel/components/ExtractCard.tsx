import type { ExtractResult } from "../lib/types";

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
    <section
      style={{
        background: "var(--tn-surface)",
        border: "1px solid var(--tn-border)",
        borderRadius: "var(--tn-r-card)",
        padding: 16,
        fontFamily: "var(--tn-font)",
        color: "var(--tn-text)",
      }}
    >
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
        <span
          style={{
            flexShrink: 0,
            fontSize: 12,
            padding: "2px 10px",
            borderRadius: "var(--tn-r-pill)",
            border: "1px solid var(--tn-border)",
            color: "var(--tn-muted)",
          }}
        >
          {CATEGORY_LABELS[result.category] ?? result.category}
        </span>
      </header>

      <p style={{ fontSize: 12, color: "var(--tn-muted)", margin: "0 0 8px" }}>
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
          background: "var(--tn-bg)",
        }}
      >
        {text}
      </div>
    </section>
  );
}
