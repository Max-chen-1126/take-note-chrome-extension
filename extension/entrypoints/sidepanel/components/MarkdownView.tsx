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
      // SECURITY: this renders raw HTML produced by `marked` from
      // backend-generated markdown. It's accepted as-is for this slice
      // because the only markdown source today is our own local backend
      // (notes/stream), reached over a developer-trusted localhost
      // connection with no untrusted/third-party input and no public
      // auth surface yet. This is a deliberate, time-boxed risk
      // acceptance, NOT a precedent: once sources widen (e.g. arbitrary
      // page content, user-pasted text) or auth goes public (Phase 2 /
      // backend Phase B), sanitize the `marked` output before injecting
      // it here — e.g. with DOMPurify, or by swapping in a markdown
      // renderer that drops raw HTML instead of passing it through.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
