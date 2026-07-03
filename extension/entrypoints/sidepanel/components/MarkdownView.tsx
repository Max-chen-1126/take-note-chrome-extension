import { marked } from "marked";
import DOMPurify from "dompurify";

export interface MarkdownViewProps {
  markdown: string;
  streaming?: boolean;
}

export function MarkdownView({ markdown, streaming = false }: MarkdownViewProps) {
  // The notes are produced by an LLM from UNTRUSTED scraped page content
  // (YouTube transcripts, arbitrary articles), and this runs in the extension's
  // privileged context (storage/identity). Sanitize the rendered HTML so any
  // injected <script>/onerror=/javascript: payload can't execute here.
  //
  // The streaming caret is appended to the local parse source only — it never
  // touches the `markdown` prop itself, so CopyButton's copied text (which
  // reads from App's own streamedMarkdown/finalMarkdown state, not from this
  // component) is unaffected.
  const source = streaming ? `${markdown}<span class="tn-stream-caret">▍</span>` : markdown;
  const html = DOMPurify.sanitize(marked.parse(source, { async: false }) as string);

  return (
    <div
      className="tn-markdown-view"
      style={{
        fontFamily: "var(--tn-font)",
        color: "var(--tn-text)",
        fontSize: 14,
        lineHeight: 1.7,
      }}
      // `html` is DOMPurify-sanitized above before injection (see comment in
      // the component body) — script/event-handler/javascript: payloads are
      // stripped, so this is safe to render even from untrusted-derived notes.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
