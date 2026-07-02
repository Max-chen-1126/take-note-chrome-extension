# Frontend Follow-up: Dark-Mode Fix, PR Review Adoption, Processing UX Polish & YouTube Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix incomplete dark-mode coverage, adopt 3 automated-review suggestions, add motion/status polish to the note-generation pipeline UI, and fix YouTube transcript extraction against YouTube's current DOM — all as follow-up commits on the still-open design-system PR.

**Architecture:** Small, mostly-independent CSS/component edits layered onto the design system that shipped in the prior 12-task plan. No new dependencies, no new architecture — every change either adds CSS rules to the existing `tokens.css` or extends an existing component's props/render output.

**Tech Stack:** WXT 0.20.27, React 19, TypeScript, Vitest + Testing Library (jsdom), `lucide-react` (already a dependency).

## Global Constraints

- Work from `extension/` for all commands (`npm test -- --run` for the suite, `npx tsc --noEmit` for type-checking).
- No color palette or typography changes — the existing minimal black/white/gray/single-Indigo-accent system stays exactly as shipped. No new dependencies.
- Numeric CSS-in-JS values stay as plain JS literals in inline `style={}` (existing codebase convention) — the one deliberate exception is `Button.tsx`'s `background` property, which moves to CSS classes in Task 2 specifically to enable `:hover`/`:active` (impossible via inline styles).
- Every new CSS `@keyframes` animation must have a matching `@media (prefers-reduced-motion: reduce)` override, following the existing `.tn-spin` convention in `tokens.css`.
- Button accessible names stay literal Chinese text with icons `aria-hidden="true"` — existing tests match via `getByRole("button", { name: /regex/ })`.
- `StepProgress`'s `data-state` attribute must stay on the same `<li>` element — the existing test walks up via `.closest("[data-state]")`.
- `--tn-primary`/`--tn-on-primary` are permanent tokens (used by `SegmentedControl`); `--tn-muted` was already removed in the prior plan — do not reintroduce it.

---

### Task 1: Dark-mode coverage fix

**Files:**
- Modify: `extension/entrypoints/sidepanel/styles/tokens.css`

**Interfaces:** None — pure CSS, no component changes.

- [ ] **Step 1: Add `color-scheme` to `:root`**

In `extension/entrypoints/sidepanel/styles/tokens.css`, the `:root { ... }` block currently starts with:
```css
:root {
  /* Primitive scale — internal to this file, never referenced directly by
     components. Semantic tokens below are the public API. */
  --tn-gray-0: #FFFFFF;
```
Add `color-scheme: light dark;` as the very first line inside the block, before the comment:
```css
:root {
  color-scheme: light dark;

  /* Primitive scale — internal to this file, never referenced directly by
     components. Semantic tokens below are the public API. */
  --tn-gray-0: #FFFFFF;
```

- [ ] **Step 2: Add a `body` reset**

Immediately after the closing `}` of the `@media (prefers-color-scheme: dark) { :root { ... } }` block and before the `.tn-app { ... }` rule, insert:
```css
body {
  margin: 0;
  min-height: 100vh;
  background: var(--tn-bg);
}
```
So the file reads (showing the relevant surrounding context):
```css
    --tn-primary: #FAFAFA;
    --tn-on-primary: var(--tn-gray-950);
  }
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--tn-bg);
}

.tn-app {
  font-family: var(--tn-font);
```

- [ ] **Step 3: Add markdown table/image/hr rules**

At the very end of the file, after the existing last rule (`.tn-markdown-view li + li { margin-top: var(--tn-space-1); }`), append:
```css

.tn-markdown-view table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 var(--tn-space-3);
  font-size: 0.95em;
}

.tn-markdown-view th,
.tn-markdown-view td {
  border: 1px solid var(--tn-border);
  padding: var(--tn-space-2) var(--tn-space-3);
  text-align: left;
}

.tn-markdown-view th {
  background: var(--tn-surface-2);
  font-weight: var(--tn-weight-semibold);
}

.tn-markdown-view img {
  max-width: 100%;
  height: auto;
  border-radius: var(--tn-r-control);
}

.tn-markdown-view hr {
  border: none;
  border-top: 1px solid var(--tn-border);
  margin: var(--tn-space-4) 0;
}
```

- [ ] **Step 4: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS — this is a pure CSS change, no test currently asserts on these properties (jsdom doesn't meaningfully evaluate CSS custom property cascades), so nothing should break. The real verification is the manual Chrome smoke test at the end of this plan.

- [ ] **Step 5: Commit**

```bash
git add extension/entrypoints/sidepanel/styles/tokens.css
git commit -m "fix(extension): add color-scheme and body reset for full dark-mode coverage"
```

---

### Task 2: Button hover/active states

**Files:**
- Modify: `extension/entrypoints/sidepanel/styles/tokens.css`
- Modify: `extension/entrypoints/sidepanel/components/ui/Button.tsx`
- Modify: `extension/tests/components/ui/Button.test.tsx`

**Interfaces:**
- Produces: `Button`'s rendered `<button>` gains a `className` computed from its `variant` prop (`"tn-btn tn-btn-primary"` / `"tn-btn tn-btn-outline"` / `"tn-btn tn-btn-ghost"`, plus any caller-supplied `className` appended) — no prop-shape change, `ButtonProps` is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `extension/tests/components/ui/Button.test.tsx` (append after the existing 2 tests, keep them unchanged):
```tsx
it("applies the variant class name alongside the base tn-btn class", () => {
  render(<Button variant="outline">按鈕</Button>);
  const button = screen.getByRole("button", { name: "按鈕" });
  expect(button.className).toContain("tn-btn");
  expect(button.className).toContain("tn-btn-outline");
});

it("defaults to the primary variant class", () => {
  render(<Button>按鈕</Button>);
  const button = screen.getByRole("button", { name: "按鈕" });
  expect(button.className).toContain("tn-btn-primary");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npm test -- --run tests/components/ui/Button.test.tsx`
Expected: the 2 new tests FAIL — `Button` currently renders no `className` at all, so `button.className` is `""`.

- [ ] **Step 3: Add the CSS classes to `tokens.css`**

At the very end of the file (after Task 1's markdown table/img/hr rules), append:
```css

.tn-btn {
  transition: background-color 0.15s ease;
}

.tn-btn-primary { background: var(--tn-accent); }
.tn-btn-primary:hover:not(:disabled) { background: var(--tn-accent-hover); }
.tn-btn-primary:active:not(:disabled) { background: var(--tn-accent-active); }

.tn-btn-outline { background: var(--tn-bg); }
.tn-btn-outline:hover:not(:disabled) { background: var(--tn-surface); }
.tn-btn-outline:active:not(:disabled) { background: var(--tn-surface-2); }

.tn-btn-ghost { background: transparent; }
.tn-btn-ghost:hover:not(:disabled) { background: var(--tn-surface); }
.tn-btn-ghost:active:not(:disabled) { background: var(--tn-surface-2); }
```

- [ ] **Step 4: Update `Button.tsx`**

Replace the entire file contents:
```tsx
import type { ButtonHTMLAttributes, CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md";
  icon?: LucideIcon;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
  type?: "button" | "submit";
}

const VARIANT_STYLE: Record<NonNullable<ButtonProps["variant"]>, CSSProperties> = {
  primary: {
    color: "var(--tn-on-accent)",
    border: "1px solid transparent",
  },
  outline: {
    color: "var(--tn-text)",
    border: "1px solid var(--tn-border)",
  },
  ghost: {
    color: "var(--tn-text)",
    border: "1px solid transparent",
  },
};

const VARIANT_CLASS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "tn-btn-primary",
  outline: "tn-btn-outline",
  ghost: "tn-btn-ghost",
};

const SIZE_STYLE: Record<NonNullable<ButtonProps["size"]>, CSSProperties> = {
  sm: { fontSize: 13, padding: "6px 12px" },
  md: { fontSize: 15, padding: "12px 16px" },
};

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  iconPosition = "left",
  fullWidth = false,
  type = "button",
  disabled,
  style,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={["tn-btn", VARIANT_CLASS[variant], className].filter(Boolean).join(" ")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontFamily: "var(--tn-font)",
        fontWeight: 600,
        borderRadius: "var(--tn-r-control)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? "100%" : undefined,
        ...VARIANT_STYLE[variant],
        ...SIZE_STYLE[size],
        ...style,
      }}
      {...rest}
    >
      {Icon && iconPosition === "left" && <Icon size={16} aria-hidden="true" />}
      {children}
      {Icon && iconPosition === "right" && <Icon size={16} aria-hidden="true" />}
    </button>
  );
}
```
Note: `background` was removed from `VARIANT_STYLE` (now lives only in the CSS classes above) — `color`/`border` stay inline exactly as before. This is the one deliberate exception to "numeric/color values stay inline" noted in Global Constraints: an inline `style` always overrides an external stylesheet rule regardless of specificity, so `background` had to move to CSS or the new `:hover`/`:active` rules would silently never fire.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd extension && npm test -- --run tests/components/ui/Button.test.tsx`
Expected: PASS (all 4 tests green — 2 existing + 2 new).

- [ ] **Step 6: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS. `Button` is used throughout the app (`CopyButton`, `ErrorState`, `App.tsx`) — confirm none of those call sites broke (they shouldn't; `className` is a new optional addition, not a breaking change).

- [ ] **Step 7: Commit**

```bash
git add extension/entrypoints/sidepanel/styles/tokens.css extension/entrypoints/sidepanel/components/ui/Button.tsx extension/tests/components/ui/Button.test.tsx
git commit -m "feat(extension): add Button hover/active states via CSS classes"
```

---

### Task 3: Toggle track transition

**Files:**
- Modify: `extension/entrypoints/sidepanel/components/ui/Toggle.tsx`
- Modify: `extension/tests/components/ui/Toggle.test.tsx`

**Interfaces:** None — no prop-shape change.

- [ ] **Step 1: Write the failing test**

Add to `extension/tests/components/ui/Toggle.test.tsx` (append after the existing test):
```tsx
it("transitions the track background color smoothly", () => {
  render(<Toggle ariaLabel="查證上網" checked={false} onChange={() => {}} />);
  const toggle = screen.getByRole("switch", { name: "查證上網" });
  expect(toggle.style.transition).toContain("background-color");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm test -- --run tests/components/ui/Toggle.test.tsx`
Expected: FAIL — `toggle.style.transition` is currently `""`.

- [ ] **Step 3: Add the transition**

In `extension/entrypoints/sidepanel/components/ui/Toggle.tsx`, the track's `style={{ ... }}` object currently reads:
```tsx
      style={{
        width: 40,
        height: 24,
        borderRadius: "var(--tn-r-pill)",
        border: "none",
        background: checked ? "var(--tn-accent)" : "var(--tn-border)",
        position: "relative",
        cursor: "pointer",
        flexShrink: 0,
        padding: 0,
      }}
```
Add one line:
```tsx
      style={{
        width: 40,
        height: 24,
        borderRadius: "var(--tn-r-pill)",
        border: "none",
        background: checked ? "var(--tn-accent)" : "var(--tn-border)",
        position: "relative",
        cursor: "pointer",
        flexShrink: 0,
        padding: 0,
        transition: "background-color 0.15s ease",
      }}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npm test -- --run tests/components/ui/Toggle.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/entrypoints/sidepanel/components/ui/Toggle.tsx extension/tests/components/ui/Toggle.test.tsx
git commit -m "feat(extension): add smooth transition to Toggle track background"
```

---

### Task 4: CopyButton ARIA nesting fix

**Files:**
- Modify: `extension/entrypoints/sidepanel/components/CopyButton.tsx`
- Create: `extension/tests/components/CopyButton.test.tsx`

**Interfaces:** `CopyButtonProps` (`{ text: string }`) unchanged. `CopyButton` now returns a Fragment (two siblings: the `Button` and a hidden live-region `span`) instead of a single `Button` element — confirmed safe at its one call site (`App.tsx`, inside a flex row; `.tn-visually-hidden` is `position: absolute` and doesn't affect flex layout).

- [ ] **Step 1: Write the failing test**

Create `extension/tests/components/CopyButton.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CopyButton } from "../../entrypoints/sidepanel/components/CopyButton";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

it("keeps the live region outside the button and announces via its text content", async () => {
  render(<CopyButton text="note content" />);

  const button = screen.getByRole("button", { name: "複製" });
  const liveRegion = screen.getByRole("status");
  expect(liveRegion.textContent).toBe("");
  expect(button.contains(liveRegion)).toBe(false);

  fireEvent.click(button);

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "已複製" })).toBeTruthy();
  });
  expect(screen.getByRole("status").textContent).toBe("已複製內容");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm test -- --run tests/components/CopyButton.test.tsx`
Expected: FAIL — the current implementation nests `role="status"` inside the button, so `button.contains(liveRegion)` is `true` and the assertion fails.

- [ ] **Step 3: Replace `CopyButton.tsx`'s contents**

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npm test -- --run tests/components/CopyButton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS — specifically confirm `App.test.tsx`'s `"transitions to result page on 開始..."` test (which asserts `getByRole("button", { name: /複製/ })`) still passes; it should, since the button's accessible name is now plain text (no nested span), an even cleaner match than before.

- [ ] **Step 6: Commit**

```bash
git add extension/entrypoints/sidepanel/components/CopyButton.tsx extension/tests/components/CopyButton.test.tsx
git commit -m "fix(extension): move CopyButton's live region outside the interactive button"
```

---

### Task 5: StepProgress step animation

**Files:**
- Modify: `extension/entrypoints/sidepanel/styles/tokens.css`
- Modify: `extension/entrypoints/sidepanel/components/StepProgress.tsx`
- Modify: `extension/tests/components/StepProgress.test.tsx`

**Interfaces:** `StepProgressProps` unchanged. `data-state` stays on the same `<li>`.

- [ ] **Step 1: Write the failing test**

Add to `extension/tests/components/StepProgress.test.tsx` (append after the existing test, keep it unchanged):
```tsx
it("renders a checkmark icon for done steps and a pulsing dot for the active step", () => {
  render(<StepProgress active="draft" doneSteps={["structure"]} />);

  const doneItem = screen.getByText("整理").closest("li")!;
  expect(doneItem.querySelector("svg")).toBeTruthy();
  expect(doneItem.querySelector(".tn-step-dot--active")).toBeNull();

  const activeItem = screen.getByText("草稿").closest("li")!;
  expect(activeItem.querySelector(".tn-step-dot--active")).toBeTruthy();
  expect(activeItem.querySelector("svg")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm test -- --run tests/components/StepProgress.test.tsx`
Expected: FAIL — the current markup has no `svg` for done steps and no `.tn-step-dot--active` class anywhere.

- [ ] **Step 3: Add the token and CSS to `tokens.css`**

In the `:root { ... }` block, immediately after these two existing lines:
```css
  --tn-primary: var(--tn-gray-950);
  --tn-on-primary: var(--tn-gray-0);
```
add:
```css

  --tn-accent-glow: rgba(79, 70, 229, 0.35);
```

In the `@media (prefers-color-scheme: dark) { :root { ... } }` block, immediately after these two existing lines:
```css
    --tn-primary: #FAFAFA;
    --tn-on-primary: var(--tn-gray-950);
```
add:
```css

    --tn-accent-glow: rgba(129, 140, 248, 0.35);
```

At the very end of the file (after Task 2's `.tn-btn-ghost:active:not(:disabled)` rule), append:
```css

@keyframes tn-step-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--tn-accent-glow); }
  50% { box-shadow: 0 0 0 4px var(--tn-accent-glow); }
}
.tn-step-dot--active {
  animation: tn-step-pulse 1.6s ease-in-out infinite;
}

.tn-step-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
}

@keyframes tn-step-check-in {
  from { transform: scale(0.4); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.tn-step-check {
  animation: tn-step-check-in 0.2s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .tn-step-dot--active { animation: none; }
  .tn-step-check { animation: none; }
}
```

- [ ] **Step 4: Replace `StepProgress.tsx`'s contents**

```tsx
import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import type { StepName } from "../lib/types";
import { STEP_LABELS } from "../lib/types";

const STEP_ORDER: StepName[] = ["structure", "draft", "augment", "verify", "format"];

type StepState = "done" | "active" | "pending";

export interface StepProgressProps {
  active: StepName | null;
  doneSteps: StepName[];
}

function stateFor(step: StepName, active: StepName | null, doneSteps: StepName[]): StepState {
  if (step === active) return "active";
  if (doneSteps.includes(step)) return "done";
  return "pending";
}

const dotStyle = (state: StepState): CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: "var(--tn-r-pill)",
  background: state === "pending" ? "var(--tn-border)" : "var(--tn-accent)",
});

export function StepProgress({ active, doneSteps }: StepProgressProps) {
  return (
    <ol
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        listStyle: "none",
        margin: 0,
        padding: 0,
        fontFamily: "var(--tn-font)",
      }}
    >
      {STEP_ORDER.map((step) => {
        const state = stateFor(step, active, doneSteps);
        return (
          <li
            key={step}
            data-state={state}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: state === "pending" ? "var(--tn-text-muted)" : "var(--tn-text)",
              fontWeight: state === "active" ? 600 : 400,
              fontSize: 12,
            }}
          >
            <span className="tn-step-marker" aria-hidden="true">
              {state === "done" ? (
                <Check size={10} strokeWidth={3} className="tn-step-check" style={{ color: "var(--tn-accent)" }} />
              ) : (
                <span
                  className={state === "active" ? "tn-step-dot--active" : undefined}
                  style={dotStyle(state)}
                />
              )}
            </span>
            <span>{STEP_LABELS[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd extension && npm test -- --run tests/components/StepProgress.test.tsx`
Expected: PASS (both tests green — the existing `data-state` test and the new marker test).

- [ ] **Step 6: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS. Confirm `App.test.tsx`'s test that checks `screen.getByText("成稿").closest("[data-state]")` having `data-state="done"` still passes (the `<li>`'s `data-state` attribute is unchanged, only the marker span's children changed).

- [ ] **Step 7: Commit**

```bash
git add extension/entrypoints/sidepanel/styles/tokens.css extension/entrypoints/sidepanel/components/StepProgress.tsx extension/tests/components/StepProgress.test.tsx
git commit -m "feat(extension): animate StepProgress markers (pulse on active, checkmark on done)"
```

---

### Task 6: Per-step status text

**Files:**
- Modify: `extension/entrypoints/sidepanel/lib/types.ts`
- Modify: `extension/entrypoints/sidepanel/components/StepProgress.tsx`
- Modify: `extension/tests/components/StepProgress.test.tsx`

**Interfaces:**
- Produces: `STEP_DESCRIPTIONS: Record<StepName, string>` exported from `lib/types.ts`, colocated with the existing `STEP_LABELS`.
- `StepProgressProps` unchanged — the description text is a pure lookup from the existing `active` prop, no new prop.

- [ ] **Step 1: Write the failing tests**

Add to `extension/tests/components/StepProgress.test.tsx` (append after the existing 2 tests):
```tsx
it("shows the active step's description text", () => {
  render(<StepProgress active="verify" doneSteps={["structure", "draft"]} />);
  expect(screen.getByText("正在對照原始內容查核論述依據…")).toBeTruthy();
});

it("shows a non-breaking-space placeholder when no step is active", () => {
  render(<StepProgress active={null} doneSteps={[]} />);
  const status = screen.getByRole("status");
  expect(status.textContent).toBe(" ");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npm test -- --run tests/components/StepProgress.test.tsx`
Expected: FAIL — `StepProgress` currently renders no status text and no `role="status"` element.

- [ ] **Step 3: Add `STEP_DESCRIPTIONS` to `lib/types.ts`**

In `extension/entrypoints/sidepanel/lib/types.ts`, immediately after this existing line:
```ts
export const STEP_LABELS:Record<StepName,string> =
  { structure:"整理", draft:"草稿", augment:"補充", verify:"查證", format:"成稿" };
```
add:
```ts

export const STEP_DESCRIPTIONS: Record<StepName, string> = {
  structure: "正在整理內容重點與段落結構…",
  draft: "正在依整理結果撰寫筆記草稿…",
  augment: "正在補充洞見與延伸連結…",
  verify: "正在對照原始內容查核論述依據…",
  format: "正在整理為最終 Markdown 筆記…",
};
```

- [ ] **Step 4: Update `StepProgress.tsx`**

Replace the entire file contents (builds on Task 5's version — wraps the `<ol>` in a `<div>` and adds the status paragraph):
```tsx
import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import type { StepName } from "../lib/types";
import { STEP_LABELS, STEP_DESCRIPTIONS } from "../lib/types";

const STEP_ORDER: StepName[] = ["structure", "draft", "augment", "verify", "format"];

type StepState = "done" | "active" | "pending";

export interface StepProgressProps {
  active: StepName | null;
  doneSteps: StepName[];
}

function stateFor(step: StepName, active: StepName | null, doneSteps: StepName[]): StepState {
  if (step === active) return "active";
  if (doneSteps.includes(step)) return "done";
  return "pending";
}

const dotStyle = (state: StepState): CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: "var(--tn-r-pill)",
  background: state === "pending" ? "var(--tn-border)" : "var(--tn-accent)",
});

export function StepProgress({ active, doneSteps }: StepProgressProps) {
  return (
    <div>
      <ol
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          listStyle: "none",
          margin: 0,
          padding: 0,
          fontFamily: "var(--tn-font)",
        }}
      >
        {STEP_ORDER.map((step) => {
          const state = stateFor(step, active, doneSteps);
          return (
            <li
              key={step}
              data-state={state}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: state === "pending" ? "var(--tn-text-muted)" : "var(--tn-text)",
                fontWeight: state === "active" ? 600 : 400,
                fontSize: 12,
              }}
            >
              <span className="tn-step-marker" aria-hidden="true">
                {state === "done" ? (
                  <Check size={10} strokeWidth={3} className="tn-step-check" style={{ color: "var(--tn-accent)" }} />
                ) : (
                  <span
                    className={state === "active" ? "tn-step-dot--active" : undefined}
                    style={dotStyle(state)}
                  />
                )}
              </span>
              <span>{STEP_LABELS[step]}</span>
            </li>
          );
        })}
      </ol>
      <p
        role="status"
        aria-live="polite"
        style={{ margin: "8px 0 0", fontSize: 12, color: "var(--tn-text-muted)", fontFamily: "var(--tn-font)" }}
      >
        {active ? STEP_DESCRIPTIONS[active] : " "}
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd extension && npm test -- --run tests/components/StepProgress.test.tsx`
Expected: PASS (all 4 tests green).

- [ ] **Step 6: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/entrypoints/sidepanel/lib/types.ts extension/entrypoints/sidepanel/components/StepProgress.tsx extension/tests/components/StepProgress.test.tsx
git commit -m "feat(extension): show a per-step status description during generation"
```

---

### Task 7: Markdown streaming caret indicator

**Files:**
- Modify: `extension/entrypoints/sidepanel/styles/tokens.css`
- Modify: `extension/entrypoints/sidepanel/components/MarkdownView.tsx`
- Modify: `extension/entrypoints/sidepanel/App.tsx`
- Modify: `extension/tests/components/MarkdownView.test.tsx`

**Interfaces:**
- Produces: `MarkdownView` gains an optional `streaming?: boolean` prop (default `false`).
- Consumes (in `App.tsx`): wired as `streaming={state.phase === "streaming"}`.

- [ ] **Step 1: Write the failing tests**

Add to `extension/tests/components/MarkdownView.test.tsx` (append after the existing 2 tests):
```tsx
it("appends a blinking caret span when streaming is true", () => {
  const { container } = render(<MarkdownView markdown="Hello" streaming />);
  const caret = container.querySelector(".tn-stream-caret");
  expect(caret).toBeTruthy();
  expect(caret?.textContent).toBe("▍");
});

it("does not render the caret when streaming is false or omitted", () => {
  const { container } = render(<MarkdownView markdown="Hello" />);
  expect(container.querySelector(".tn-stream-caret")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npm test -- --run tests/components/MarkdownView.test.tsx`
Expected: the first new test FAILs (`MarkdownView` doesn't accept a `streaming` prop yet, and renders no caret); the second passes trivially (already true) but should be re-verified after the implementation too.

- [ ] **Step 3: Add the caret CSS to `tokens.css`**

At the very end of the file (after Task 5's `prefers-reduced-motion` block), append:
```css

@keyframes tn-caret-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
.tn-stream-caret {
  display: inline-block;
  margin-left: 2px;
  color: var(--tn-accent);
  animation: tn-caret-blink 1s step-end infinite;
}
@media (prefers-reduced-motion: reduce) {
  .tn-stream-caret { animation: none; opacity: 0.6; }
}
```

- [ ] **Step 4: Update `MarkdownView.tsx`**

Replace the entire file contents:
```tsx
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
```

- [ ] **Step 5: Wire `streaming` in `App.tsx`**

In `extension/entrypoints/sidepanel/App.tsx`, find the line:
```tsx
      <MarkdownView markdown={markdownToShow} />
```
Replace it with:
```tsx
      <MarkdownView markdown={markdownToShow} streaming={state.phase === "streaming"} />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd extension && npm test -- --run tests/components/MarkdownView.test.tsx`
Expected: PASS (all 4 tests green).

- [ ] **Step 7: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS. `App.test.tsx`'s tests that check for final markdown text (e.g. `screen.getByText("這是內容第一段。")`) should be unaffected — the caret is a separate `<span>`, not part of the text node being matched.

- [ ] **Step 8: Commit**

```bash
git add extension/entrypoints/sidepanel/styles/tokens.css extension/entrypoints/sidepanel/components/MarkdownView.tsx extension/entrypoints/sidepanel/App.tsx extension/tests/components/MarkdownView.test.tsx
git commit -m "feat(extension): add a blinking streaming-caret indicator to MarkdownView"
```

---

### Task 8: Extraction-phase skeleton

**Files:**
- Create: `extension/entrypoints/sidepanel/components/ExtractCardSkeleton.tsx`
- Create: `extension/tests/components/ExtractCardSkeleton.test.tsx`
- Modify: `extension/entrypoints/sidepanel/styles/tokens.css`
- Modify: `extension/entrypoints/sidepanel/App.tsx`
- Modify: `extension/tests/components/App.test.tsx`

**Interfaces:**
- Produces: `ExtractCardSkeleton()` — a zero-prop component rendering shimmering placeholder bars inside a `Card`.
- Consumes (in `App.tsx`): a new `showSkeleton: boolean` state, `true` only after the `extracting` phase has been active for 500ms (via `setTimeout`), reset on every phase change.

- [ ] **Step 1: Write the failing test for `ExtractCardSkeleton`**

Create `extension/tests/components/ExtractCardSkeleton.test.tsx`:
```tsx
import { render } from "@testing-library/react";
import { ExtractCardSkeleton } from "../../entrypoints/sidepanel/components/ExtractCardSkeleton";

it("renders skeleton placeholder bars without crashing", () => {
  const { container } = render(<ExtractCardSkeleton />);
  const bars = container.querySelectorAll(".tn-skeleton");
  expect(bars.length).toBeGreaterThanOrEqual(6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm test -- --run tests/components/ExtractCardSkeleton.test.tsx`
Expected: FAIL — `Cannot find module '.../components/ExtractCardSkeleton'`.

- [ ] **Step 3: Add the shimmer CSS to `tokens.css`**

At the very end of the file (after Task 7's caret `prefers-reduced-motion` block), append:
```css

@keyframes tn-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.tn-skeleton {
  border-radius: var(--tn-r-control);
  background: linear-gradient(90deg, var(--tn-surface-2) 25%, var(--tn-border) 50%, var(--tn-surface-2) 75%);
  background-size: 200% 100%;
  animation: tn-shimmer 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .tn-skeleton { animation: none; }
}
```

- [ ] **Step 4: Create `ExtractCardSkeleton.tsx`**

```tsx
import { Card } from "./ui/Card";

export function ExtractCardSkeleton() {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <div className="tn-skeleton" style={{ height: 20, width: "60%", borderRadius: 4 }} />
        <div className="tn-skeleton" style={{ height: 20, width: 56, borderRadius: 9999, flexShrink: 0 }} />
      </div>
      <div className="tn-skeleton" style={{ height: 12, width: 80, borderRadius: 4, marginBottom: 8 }} />
      <div
        style={{
          border: "1px solid var(--tn-border)",
          borderRadius: "var(--tn-r-control)",
          padding: 12,
          background: "var(--tn-surface-2)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div className="tn-skeleton" style={{ height: 14, width: "100%", borderRadius: 4 }} />
        <div className="tn-skeleton" style={{ height: 14, width: "95%", borderRadius: 4 }} />
        <div className="tn-skeleton" style={{ height: 14, width: "88%", borderRadius: 4 }} />
        <div className="tn-skeleton" style={{ height: 14, width: "60%", borderRadius: 4 }} />
      </div>
    </Card>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd extension && npm test -- --run tests/components/ExtractCardSkeleton.test.tsx`
Expected: PASS.

- [ ] **Step 6: Write the failing test for the gating behavior in `App.test.tsx`**

Add to `extension/tests/components/App.test.tsx` (append after the existing 6 tests; add `import { act } from "react";` to the top of the file alongside the existing imports):
```tsx
it("shows the skeleton only after extraction has been pending for 500ms", async () => {
  vi.useFakeTimers();
  let resolveExtract: (r: ExtractResult) => void = () => {};
  const extract = vi.fn(
    () => new Promise<ExtractResult>((resolve) => { resolveExtract = resolve; })
  );
  const deps = makeDeps({ extract });
  render(<App deps={deps} />);

  act(() => { vi.advanceTimersByTime(499); });
  expect(document.querySelector(".tn-skeleton")).toBeNull();

  act(() => { vi.advanceTimersByTime(1); });
  expect(document.querySelector(".tn-skeleton")).not.toBeNull();

  act(() => { resolveExtract(extractResult); });
  vi.useRealTimers();
  await screen.findByText("測試影片標題");
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd extension && npm test -- --run tests/components/App.test.tsx`
Expected: the new test FAILs (`App.tsx` doesn't render any `.tn-skeleton` element yet); confirm the 6 pre-existing tests still pass unmodified.

- [ ] **Step 8: Wire the skeleton gate into `App.tsx`**

Add the import (alongside the existing component imports near the top of the file):
```tsx
import { ExtractCardSkeleton } from "./components/ExtractCardSkeleton";
```

Add a new state and effect, immediately after the existing `runIdRef` declaration and before the `runExtract` function:
```tsx
  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    if (state.phase !== "extracting") {
      setShowSkeleton(false);
      return;
    }
    const timer = setTimeout(() => setShowSkeleton(true), 500);
    return () => clearTimeout(timer);
  }, [state.phase]);
```

Replace the `extracting`-phase render branch:
```tsx
  if (state.phase === "extracting") {
    return (
      <div className="tn-app" style={pageStyle}>
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            minHeight: 200,
          }}
        >
          <Spinner size={24} />
          <p style={{ margin: 0, fontSize: 14, color: "var(--tn-text-muted)" }}>擷取中…</p>
        </div>
      </div>
    );
  }
```
with:
```tsx
  if (state.phase === "extracting") {
    return (
      <div className="tn-app" style={pageStyle}>
        <div role="status" aria-live="polite">
          <span className="tn-visually-hidden">擷取中…</span>
          {showSkeleton ? (
            <ExtractCardSkeleton />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                minHeight: 200,
              }}
            >
              <Spinner size={24} />
              <p style={{ margin: 0, fontSize: 14, color: "var(--tn-text-muted)" }}>擷取中…</p>
            </div>
          )}
        </div>
      </div>
    );
  }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd extension && npm test -- --run tests/components/App.test.tsx`
Expected: PASS (all 7 tests green — 6 existing + 1 new). The existing tests all use `mockResolvedValue`/immediately-resolving promises for `extract`, so extraction finishes on the next microtask, well under the 500ms gate — they never observe the skeleton and are unaffected.

- [ ] **Step 10: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add extension/entrypoints/sidepanel/components/ExtractCardSkeleton.tsx extension/tests/components/ExtractCardSkeleton.test.tsx extension/entrypoints/sidepanel/styles/tokens.css extension/entrypoints/sidepanel/App.tsx extension/tests/components/App.test.tsx
git commit -m "feat(extension): show a gated skeleton instead of a bare spinner during slow extraction"
```

---

### Task 9: YouTube transcript extractor fix

**Files:**
- Modify: `extension/src/extractors/youtube.ts`
- Create: `extension/tests/extractors/fixtures/youtube-panel-modern.html`
- Modify: `extension/tests/extractors/youtube.test.ts`

**Interfaces:** `parsePanelDom(doc: Document): string` signature unchanged. `pickCaptionBaseUrl`, `needsFallback`, `parseJson3` unaffected — this task only touches the DOM-scraping fallback function.

- [ ] **Step 1: Create the modern fixture**

Create `extension/tests/extractors/fixtures/youtube-panel-modern.html`:
```html
<!--
  Synthetic fixture: a trimmed snippet shaped like YouTube's current "modern transcript
  view" panel DOM (yt-section-list-renderer[data-target-id="PAmodern_transcript_view"] >
  macro-markers-panel-item-view-model > timeline-item-view-model >
  transcript-segment-view-model), used to validate parsePanelDom's modern-panel selectors.
  Not captured from a live page; segment text is synthetic.
-->
<yt-section-list-renderer data-target-id="PAmodern_transcript_view">
  <div class="ytSectionListRendererContents">
    <div>
      <macro-markers-panel-item-view-model tabindex="0" role="button">
        <timeline-item-view-model class="ytwTimelineItemViewModelHost">
          <div class="ytwTimelineItemViewModelContentItems">
            <transcript-segment-view-model class="ytwTranscriptSegmentViewModelHost">
              <div class="ytwTranscriptSegmentViewModelTimestamp">0:00</div>
              <span class="ytAttributedStringHost" role="text">Hey everyone, welcome back to the channel.</span>
            </transcript-segment-view-model>
          </div>
        </timeline-item-view-model>
      </macro-markers-panel-item-view-model>
    </div>
    <div>
      <macro-markers-panel-item-view-model tabindex="0" role="button">
        <timeline-item-view-model class="ytwTimelineItemViewModelHost">
          <div class="ytwTimelineItemViewModelContentItems">
            <transcript-segment-view-model class="ytwTranscriptSegmentViewModelHost">
              <div class="ytwTranscriptSegmentViewModelTimestamp">0:04</div>
              <span class="ytAttributedStringHost" role="text">Today we're going to walk through how transcript extraction works for this extension.</span>
            </transcript-segment-view-model>
          </div>
        </timeline-item-view-model>
      </macro-markers-panel-item-view-model>
    </div>
    <div>
      <macro-markers-panel-item-view-model tabindex="0" role="button">
        <timeline-item-view-model class="ytwTimelineItemViewModelHost">
          <div class="ytwTimelineItemViewModelContentItems">
            <transcript-segment-view-model class="ytwTranscriptSegmentViewModelHost">
              <div class="ytwTranscriptSegmentViewModelTimestamp">0:08</div>
              <span class="ytAttributedStringHost" role="text">When the json3 endpoint is blocked, the content script falls back to reading this panel instead.</span>
            </transcript-segment-view-model>
          </div>
        </timeline-item-view-model>
      </macro-markers-panel-item-view-model>
    </div>
    <div>
      <macro-markers-panel-item-view-model tabindex="0" role="button">
        <timeline-item-view-model class="ytwTimelineItemViewModelHost">
          <div class="ytwTimelineItemViewModelContentItems">
            <transcript-segment-view-model class="ytwTranscriptSegmentViewModelHost">
              <div class="ytwTranscriptSegmentViewModelTimestamp">0:13</div>
              <span class="ytAttributedStringHost" role="text">Each segment renders inside its own transcript-segment-view-model element now.</span>
            </transcript-segment-view-model>
          </div>
        </timeline-item-view-model>
      </macro-markers-panel-item-view-model>
    </div>
    <div>
      <macro-markers-panel-item-view-model tabindex="0" role="button">
        <timeline-item-view-model class="ytwTimelineItemViewModelHost">
          <div class="ytwTimelineItemViewModelContentItems">
            <transcript-segment-view-model class="ytwTranscriptSegmentViewModelHost">
              <div class="ytwTranscriptSegmentViewModelTimestamp">0:18</div>
              <span class="ytAttributedStringHost" role="text">Thanks for watching, and see you in the next one.</span>
            </transcript-segment-view-model>
          </div>
        </timeline-item-view-model>
      </macro-markers-panel-item-view-model>
    </div>
  </div>
</yt-section-list-renderer>
```

- [ ] **Step 2: Write the failing test**

Add to `extension/tests/extractors/youtube.test.ts` (append after the existing `"parses transcript panel DOM as fallback"` test, which stays unchanged — it still exercises the legacy fixture and proves the legacy fallback branch still works):
```ts
it("parses the modern transcript panel DOM", () => {
  const doc = new JSDOM(readFileSync("tests/extractors/fixtures/youtube-panel-modern.html", "utf8")).window.document;
  const result = parsePanelDom(doc);

  const segment1 = "Hey everyone, welcome back to the channel.";
  const segment2 = "Today we're going to walk through how transcript extraction works for this extension.";
  const segment3 = "When the json3 endpoint is blocked, the content script falls back to reading this panel instead.";
  const segment4 = "Each segment renders inside its own transcript-segment-view-model element now.";
  const segment5 = "Thanks for watching, and see you in the next one.";

  expect(result).toContain(segment1);
  expect(result).toContain(segment2);
  expect(result).toContain(segment3);
  expect(result).toContain(segment4);
  expect(result).toContain(segment5);

  expect(result).not.toContain("0:00");
  expect(result).not.toContain("0:04");
  expect(result).not.toContain("0:08");
  expect(result).not.toContain("0:13");
  expect(result).not.toContain("0:18");

  const expected = `${segment1} ${segment2} ${segment3} ${segment4} ${segment5}`;
  expect(result).toBe(expected);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd extension && npm test -- --run tests/extractors/youtube.test.ts`
Expected: the new test FAILs — `parsePanelDom` currently only queries `.segment-text`, which matches nothing in the modern fixture, so `result` is `""`, not the expected joined string.

- [ ] **Step 4: Update `parsePanelDom` in `youtube.ts`**

In `extension/src/extractors/youtube.ts`, replace:
```ts
export function parsePanelDom(doc: Document): string {
  const segs = Array.from(doc.querySelectorAll(".segment-text"));
  return segs.map(n => (n.textContent ?? "").trim()).filter(Boolean).join(" ").trim();
}
```
with:
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
Leave `pickCaptionBaseUrl`, `needsFallback`, and `parseJson3` (the rest of the file) unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd extension && npm test -- --run tests/extractors/youtube.test.ts`
Expected: PASS (all tests green — the pre-existing legacy-fixture test AND the new modern-fixture test both pass, since `parsePanelDom` now tries the modern selector first and only falls back to `.segment-text` when zero modern segments are found).

- [ ] **Step 6: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/extractors/youtube.ts extension/tests/extractors/fixtures/youtube-panel-modern.html extension/tests/extractors/youtube.test.ts
git commit -m "fix(extension): parse YouTube's modern transcript-panel DOM in parsePanelDom"
```

## Verification

- `cd extension && npm test -- --run` and `npx tsc --noEmit` after every task — both clean throughout.
- Manual Chrome smoke test (the actual point of this whole follow-up — reload the unpacked
  extension after building):
  - Confirm the `<select>` dropdown popup and scrollbars render dark in dark mode with no
    white edges anywhere (toggle OS Appearance to confirm).
  - Hover and click every `Button` variant (primary/outline/ghost) and confirm visible
    hover/active color feedback.
  - Toggle the web-search switch and confirm the track color transitions smoothly.
  - Copy a finished note and confirm the visible "已複製" state still reads correctly (this
    is now plain button text, not a nested live region).
  - Run a real generation (once the local backend is running, per the `backend/.env` +
    `extension/.env` setup already documented for this branch) and confirm: the active
    step's dot pulses, a step swaps to a checkmark on completion, the status line updates
    per step, a caret blinks/solidifies appropriately during token streaming, and — if
    extraction is ever slow enough to cross 500ms — the skeleton card appears instead of
    the bare spinner.
  - Open a real YouTube video, extract it, and confirm the transcript now populates
    (previously silently empty against the modern transcript panel).
