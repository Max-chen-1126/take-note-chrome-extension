# Frontend Design System & UI/UX Rebuild — Design

> Sub-project **A** of a three-part staged upgrade to `take-note-chrome-extension`:
> (A) this document, (B) backend observability/stability/security — shipped and merged
> via PR #5, (C) cost observability & tiered control — not yet started.

## Context

The side panel currently has zero shared styling infrastructure: 5 color tokens (no
accent, no dark mode), no spacing/typography scale, and every component defines its own
duplicated inline `style={}` objects. Loading/error states are minimal (plain text, no
spinner, no retry), there's no icon system (raw unicode glyphs: ▶ ‹ ⧉), and there are no
visible focus styles for keyboard/accessibility. The goal is a small, hand-built design
system (no CSS framework) that fixes these rough edges without over-building for what is
a single-screen, single-user personal tool.

Decisions locked in with the user before this design was written:
- **No Tailwind, no headless component library.** Expand `tokens.css` + build ~8 small
  shared primitives. Zero new styling dependencies (one new dependency overall:
  `lucide-react` for icons).
- **Visual tone: minimal black/white/gray + exactly one accent color** — Indigo
  (`#4F46E5` light / `#818CF8` dark), chosen for reading as a single deliberate "brand"
  touch without competing with the existing monochrome palette. (Blue `#2563EB` was
  offered as a more conventional alternative; the user confirmed Indigo.)
- **Dark mode in scope**, auto-switching via `prefers-color-scheme` (no manual toggle UI
  — token structure keeps a future manual toggle cheap to add later).
- **Icons: `lucide-react`**, replacing every raw unicode glyph.

## Goals

1. Replace duplicated inline-style patterns across every side-panel component with a
   small, reusable `ui/` primitive library plus an expanded token system.
2. Add dark mode (auto, `prefers-color-scheme`) without a manual toggle.
3. Fix known UX rough edges: no loading spinner, no retry affordance on error states, no
   icon system, no visible keyboard focus styles.
4. Do this with a single new dependency (`lucide-react`) and zero new business logic
   beyond the one explicitly-flagged exception (extracting a `runExtract()` function so
   retry has something to call).

## Non-goals

- No CSS framework (Tailwind) or headless component library (Radix) — hand-built only.
- No manual dark-mode toggle UI this round (token structure supports adding one later).
- No new screens, no new backend calls, no new SSE event handling, no new persisted
  state beyond what's needed for the retry affordance.
- No general-purpose component library beyond what today's 4 screens actually need — no
  `Modal`/`Dialog`/`Tooltip`/`Tabs`, no generic `Icon` wrapper.

## Design

### 1. Token system (`extension/entrypoints/sidepanel/styles/tokens.css`)

Expand in place (stays the single global stylesheet). Two layers: primitive color scales
(`--tn-gray-*`, `--tn-accent-*`, `--tn-red-*`, never referenced directly by components) →
semantic tokens (`--tn-bg`, `--tn-text`, `--tn-accent`, etc.), defined under `:root` for
light and overridden inside `@media (prefers-color-scheme: dark) { :root { ... } }` for
dark.

Concrete starting values (light / dark):
- `--tn-bg` `#FFFFFF` / `#0A0A0A`, `--tn-surface` `#FAFAFA` / `#161616`, `--tn-surface-2`
  (new — nested wells: preview box, code blocks) `#F5F5F5` / `#1F1F1F`
- `--tn-border` `#E5E5E5` / `#2A2A2A`, `--tn-border-strong` (new) `#D4D4D4` / `#3D3D3D`
- `--tn-text` `#0A0A0A` / `#FAFAFA`, `--tn-text-muted` `#737373` / `#A1A1A1`,
  `--tn-text-disabled` (new) `#A3A3A3` / `#6B6B6B`
- `--tn-accent` `#4F46E5` / `#818CF8`, with `-hover`/`-active`/`-subtle`/`on-accent`
  variants (light gets *darker* on hover, dark gets *lighter* on hover)
- `--tn-danger` (new, status color only) `#DC2626` / `#F87171`, with
  `-subtle`/`on-danger`
- `--tn-focus-ring`: tracks `--tn-accent`
- Radius (`--tn-r-control` 10px, `--tn-r-card` 16px, `--tn-r-pill` 9999px): unchanged.

New typography scale (`--tn-text-xs` 12px through `--tn-text-xl` 20px, plus weight and
line-height tokens) and a 4px-grid spacing scale (`--tn-space-0` 2px through
`--tn-space-8` 32px).

New global rules (outside `:root`): `:focus-visible` ring using `--tn-focus-ring`, a
`.tn-visually-hidden` utility, a `.tn-spin` keyframe animation, and a
`prefers-reduced-motion` override.

**Migration-safety requirement:** the current `tokens.css` has `--tn-muted` (not
`--tn-text-muted`), referenced directly in 6 places across `App.tsx` (×3),
`SettingsForm.tsx`, `StepProgress.tsx`, and `ExtractCard.tsx` (verified by grep).
`--tn-muted` must be kept as a deprecated alias (`--tn-muted: var(--tn-text-muted);`)
alongside `--tn-primary`/`--tn-on-primary` through the whole migration window, removed
together in the final cleanup step.

### 2. Component inventory (`extension/entrypoints/sidepanel/components/ui/`, new directory)

8 generic primitives + 1 domain composition kept outside `ui/`:

| Component | Replaces |
|---|---|
| `Button` (`variant`: primary/outline/ghost, optional lucide `icon`) | `App.tsx`'s `primaryButtonStyle`/`ghostButtonStyle`, `CopyButton.tsx`'s inline button |
| `Card` | `ExtractCard.tsx`'s outer `<section>`, reused inside `ErrorState` |
| `Badge` | `ExtractCard.tsx`'s category pill |
| `FormField` | `SettingsForm.tsx`'s repeated label wrapper (3×) |
| `TextInput` / `Select` | `SettingsForm.tsx`'s shared `controlStyle` on the direction input / methodology select |
| `SegmentedControl` | `SettingsForm.tsx`'s mode-picker button-group loop |
| `Toggle` | `SettingsForm.tsx`'s web-search switch — becomes a real `<button role="switch">` instead of a `<span tabIndex>` |
| `Spinner` | new — `extracting` phase only |
| `ErrorState` *(stays flat, not in `ui/`)* | `App.tsx`'s `errorBoxStyle` usage in both `extract_error` and `stream_error` |

Deliberately not built: generic `Icon` wrapper, `Modal`/`Dialog`/`Tooltip`, `Tabs`.

### 3. Per-screen changes

**Accent-color allocation**: primary CTA, `StepProgress` active/done dots, markdown
links, `ErrorState` retry buttons, the focus ring, and the web-search `Toggle`'s "on"
state use `--tn-accent`. `SegmentedControl`'s selected pill and the category `Badge`
stay **neutral** — selections/information, not actions.

- **`extracting`**: centered `role="status" aria-live="polite"` block with `Spinner`
  above the existing "擷取中…" text.
- **`extract_error` / `stream_error`**: `<ErrorState>` (icon + title + message + retry
  `Button`). **The one behavior change**: `App.tsx`'s inline extract-on-mount logic
  becomes a standalone `runExtract()` function so retry has something to call (mirrors
  the existing mount-effect path; `AppState` shape unchanged). `stream_error`'s retry
  calls the existing `handleStart()`.
- **`ready`**: `ExtractCard` → `Card`/`Badge`; `SettingsForm` → `FormField`/`Select`/
  `TextInput`/`SegmentedControl`/`Toggle`; primary button → `Button variant="primary"
  icon={Sparkles}` (replacing `▶`).
- **`streaming`/`done`/`stream_error`**: back button → `Button variant="ghost"
  icon={ChevronLeft}` (replaces `‹`); `CopyButton` → `Button variant="outline"` with
  `Copy`→`Check` icon swap (replaces `⧉`), wrapped in `role="status" aria-live="polite"`;
  `StepProgress` dots recolor to `--tn-accent`.
- **`MarkdownView`**: no `.tsx` change; `.tn-markdown-view` (applied but currently has
  zero matching CSS rules) gains real typographic rules for headings, code, links,
  blockquotes, lists.
- **Cross-cutting**: `role="status" aria-live="polite"` on the top-level phase container.

### 4. File structure

```
extension/entrypoints/sidepanel/
  components/
    ui/                      <- NEW: Button, Card, Badge, FormField, TextInput, Select,
                                 SegmentedControl, Toggle, Spinner, index.ts
    ErrorState.tsx            <- NEW, domain-level, stays flat
    ExtractCard.tsx / SettingsForm.tsx / StepProgress.tsx / CopyButton.tsx  <- MODIFIED
    MarkdownView.tsx          <- unchanged .tsx; CSS-only change in tokens.css
  styles/tokens.css           <- MODIFIED in place
  App.tsx                     <- MODIFIED
```

`extension/package.json` gets one new dependency: `lucide-react` (pin an exact minor
whose peerDependencies include React 19).

### 5. Build sequencing

1. Add `lucide-react`.
2. Rewrite `tokens.css` fully (incl. `--tn-primary`/`--tn-on-primary`/`--tn-muted`
   deprecated aliases). Pure CSS; `vitest run` stays green.
3. Build `ui/` primitives leaf-first: `Spinner` → `Badge` → `Card` → `Button` →
   `FormField` → `TextInput` → `Select` → `SegmentedControl` → `Toggle`.
4. Build `ErrorState` (unwired).
5. Migrate `CopyButton.tsx`.
6. Migrate `StepProgress.tsx` (keep `data-state` on the same `<li>`).
7. Migrate `ExtractCard.tsx`.
8. Migrate `SettingsForm.tsx` + add `SettingsForm.test.tsx` (new file — `Toggle`'s
   span→button change is the one real DOM-node-type change, currently zero coverage).
9. Add `.tn-markdown-view` typography CSS.
10. Migrate `App.tsx` (the one logic-touching step: `runExtract()` + retry wiring).
11. Update `App.test.tsx`: existing name-keyed assertions should keep passing; add two
    new retry-behavior cases.
12. Cleanup: remove deprecated aliases once no references remain; full `vitest run` +
    manual Chrome smoke test (light/dark toggle, keyboard focus rings, both retries).

### 6. Testing approach

Visual/structural refactor, not new business logic. None of the four existing test files
(`App.test.tsx`, `ExtractCard.test.tsx`, `StepProgress.test.tsx`, `MarkdownView.test.tsx`)
query by CSS class or DOM tag beyond `h1`/`[data-state]` — resilient to the refactor as
long as button accessible names stay literal Chinese text (icons `aria-hidden="true"`).
Two genuinely new pieces of coverage: `SettingsForm.test.tsx` and two retry-behavior
cases in `App.test.tsx`.

## Verification

- `cd extension && npm test -- --run` after each numbered step in §5.
- Manual smoke test: `npm run build` / WXT dev mode, load unpacked in Chrome, run through
  all phases including both error/retry paths, toggle OS Appearance Light/Dark, tab
  through all controls with the keyboard.
- Final grep check that no `--tn-primary`/`--tn-on-primary`/`--tn-muted` references
  remain before deleting the deprecated aliases.
