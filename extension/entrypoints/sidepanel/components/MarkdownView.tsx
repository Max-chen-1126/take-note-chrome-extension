import { marked } from "marked";

export interface MarkdownViewProps {
  markdown: string;
}

// Trusting backend-generated markdown for this slice (no client-side sanitization).
export function MarkdownView({ markdown }: MarkdownViewProps) {
  const html = marked.parse(markdown, { async: false }) as string;

  return (
    <div
      className="tn-markdown-view"
      style={{
        fontFamily: "var(--tn-font)",
        color: "var(--tn-text)",
        fontSize: 14,
        lineHeight: 1.7,
      }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
