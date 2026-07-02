# Sub-project A Follow-up: Dark-Mode Fix, PR Review Adoption, Processing UX Polish & YouTube Fix — Design

> Follow-up to PR #6 (branch `worktree-frontend-design-system`, not yet merged), which
> shipped the hand-built design system. This document covers a second pass on the same
> branch before merge.

## Context

PR #6 shipped the token system (dark mode, single Indigo accent), 9 `ui/` primitives,
`ErrorState`, and a full migration of every side-panel component. The user tested it live in
Chrome and found two real issues, received an automated PR review with 3 suggestions, and
— having now seen the actual generation flow — wants a second pass specifically on the
processing experience's motion/UX so it reads as "same-tier product" quality. They
explicitly confirmed: **keep the current minimal black/white/gray/single-indigo-accent
color system** — this is bug fixing and motion/interaction polish, not a visual identity
change.

All work lands as additional commits on the same open branch/PR, since it's fixing/polishing
work still on unreviewed-and-unmerged code.

Three root causes were diagnosed (read-only investigation, verified against actual source):

1. **Dark mode incomplete** ("只有部分是 dark，其他都還是白色的"): `tokens.css`'s `:root`
   never declares `color-scheme: light dark`, so native browser chrome (the `<select>`
   dropdown popup, scrollbars) renders light regardless of the page's dark tokens.
   Separately, neither `index.html` nor `tokens.css` resets `body` — the UA default 8px
   margin plus any viewport space below short content shows raw white.
2. **Methodology dropdown empty / can't test generation locally**: not a code bug — no
   `extension/.env` exists in this worktree, so the extension falls back to
   `http://localhost:8080`, which has nothing listening. Local dev-environment setup gap,
   not fixed in code by this plan.
3. **YouTube transcript extraction broken**: `extension/src/extractors/youtube.ts`'s
   `parsePanelDom()` (DOM-scraping fallback, used when the primary json3-captions-API path
   fails) queries `.segment-text` — a class from YouTube's OLD transcript panel markup.
   YouTube has since shipped a "modern transcript view" panel
   (`data-target-id="PAmodern_transcript_view"`) using different custom elements
   (`transcript-segment-view-model`, text in `span[role="text"]`, timestamps in
   `.ytwTranscriptSegmentViewModelTimestamp`) — confirmed from a live DOM dump the user
   captured. `.segment-text` matches zero nodes against the new panel, so `parsePanelDom`
   silently returns empty. The existing fixture
   (`tests/extractors/fixtures/youtube-panel.html`) mirrors the OLD structure and was never
   validated against the live DOM.

## Goals

1. Fix the dark-mode coverage bug.
2. Adopt (with one deliberate improvement) 3 suggestions from the `gemini-code-assist` bot's
   PR review: Button hover/active states, Toggle track transition, CopyButton ARIA nesting
   fix.
3. Add motion/UX polish to the processing experience: animated step progress, per-step
   status text, a subtle streaming-text indicator, and a gated skeleton loading state.
4. Fix YouTube transcript extraction against the modern panel DOM.

## Non-goals

- No color palette or typography changes.
- No new dependencies.
- No diffing/incremental markdown parsing (evaluated and rejected — `marked` has no
  streaming parse mode, making diff-based "new content" detection unsafe).

## Design

### 1. Dark-mode fix (`tokens.css`)

- `color-scheme: light dark;` on `:root` (one declaration, self-syncs with the existing
  `@media (prefers-color-scheme: dark)` block).
- `body { margin: 0; min-height: 100vh; background: var(--tn-bg); }`.
- `.tn-markdown-view` rules for `table`/`th`/`td`/`img`/`hr`.

### 2. PR review adoption

**a) Button hover/active**: move only `background` out of `Button.tsx`'s inline
`VARIANT_STYLE` into new CSS classes (`.tn-btn-primary`/`.tn-btn-outline`/`.tn-btn-ghost` +
`:hover:not(:disabled)`/`:active:not(:disabled)`, using the already-defined
`--tn-accent-hover`/`--tn-accent-active`/`--tn-surface`/`--tn-surface-2` tokens) — not React
state, to avoid per-instance re-renders for a purely visual effect. `color`/`border` stay
inline.

**b) Toggle track transition**: add `transition: "background-color 0.15s ease"` to the
track's inline style.

**c) CopyButton ARIA fix**: move the `role="status" aria-live="polite"` region out of the
`<Button>`'s children into an always-mounted `.tn-visually-hidden` sibling span (Fragment
return, safe at the one call site since the hidden span is `position: absolute`).

### 3. Processing-experience motion/UX

**a) `StepProgress` animation**: pulse/glow `@keyframes` on the active dot (new
`--tn-accent-glow` token, light+dark), swap to a bare `Check` glyph on active→done (element
swap → free remount animation), `prefers-reduced-motion` override on every new keyframe.

**b) Per-step status text**: `STEP_DESCRIPTIONS: Record<StepName, string>` lookup in
`lib/types.ts`:
```
structure: 正在整理內容重點與段落結構…
draft:     正在依整理結果撰寫筆記草稿…
augment:   正在補充洞見與延伸連結…
verify:    正在對照原始內容查核論述依據…
format:    正在整理為最終 Markdown 筆記…
```
Rendered below `StepProgress`'s dots, `role="status" aria-live="polite"`, non-breaking-space
placeholder when idle.

**c) Markdown streaming indicator**: rejected diffing (unsafe, `marked` reshapes trailing
content unpredictably) and rejected whole-container flash (would strobe at token-level
delta rates). Adopted: a blinking-caret span (`▍`) appended to the local parse-source string
when `streaming` prop is true — never touches the `markdown` prop, so copy is unaffected.
Accepted tradeoffs: solidifies (doesn't visibly blink) during fast streaming — treated as a
feature; can render literally inside an unclosed code fence — rare, self-correcting.

**d) Extraction-phase skeleton**: 500ms-gated (`setTimeout`, re-arms on retry via
`state.phase` dependency) `ExtractCardSkeleton` using the `Card` primitive + a
`.tn-skeleton` shimmer gradient class.

### 4. YouTube transcript extractor fix

`parsePanelDom()` in `extension/src/extractors/youtube.ts` gets a modern-panel-first,
legacy-fallback rewrite:
```ts
export function parsePanelDom(doc: Document): string {
  const modern = Array.from(doc.querySelectorAll("transcript-segment-view-model"));
  if (modern.length > 0) {
    return modern
      .map((seg) => (seg.querySelector('span[role="text"]')?.textContent ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  const legacy = Array.from(doc.querySelectorAll(".segment-text"));
  return legacy.map((n) => (n.textContent ?? "").trim()).filter(Boolean).join(" ").trim();
}
```
New fixture `tests/extractors/fixtures/youtube-panel-modern.html` (5 synthetic segments,
matching the real `PAmodern_transcript_view` structure), new test asserting the modern path
extracts correctly — this is the test that would have caught the original production bug.
`pickCaptionBaseUrl`/`needsFallback`/`parseJson3` (the primary json3-API path) are
unaffected.

## File structure

```
extension/entrypoints/sidepanel/
  styles/tokens.css                    <- MODIFIED
  components/
    ui/Button.tsx                      <- MODIFIED
    ui/Toggle.tsx                      <- MODIFIED
    CopyButton.tsx                     <- MODIFIED
    StepProgress.tsx                   <- MODIFIED
    MarkdownView.tsx                   <- MODIFIED
    ExtractCardSkeleton.tsx            <- NEW
  App.tsx                              <- MODIFIED
  lib/types.ts                         <- MODIFIED
src/extractors/youtube.ts              <- MODIFIED
tests/extractors/
  fixtures/youtube-panel-modern.html   <- NEW
  youtube.test.ts                      <- MODIFIED
```

## Verification

- `cd extension && npm test -- --run` and `npx tsc --noEmit` after each change.
- Manual Chrome smoke test: dark-mode select/scrollbar coverage, button hover/active,
  toggle transition, copy state, step animation/status text/caret/skeleton during a real
  generation run, and YouTube transcript extraction on a real video.
