# Frontend Design System & UI/UX Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the side panel's ad-hoc, duplicated inline-style UI with a small hand-built design system (expanded tokens + a `ui/` primitive library), add dark mode, and fix known UX rough edges (no loading spinner, no retry affordance, no icon system, no visible focus styles).

**Architecture:** Two-layer CSS custom-property token system (`extension/entrypoints/sidepanel/styles/tokens.css`) consumed by ~8 new small React primitives in a new `components/ui/` directory, which every existing side-panel component then migrates onto one file at a time. The only new dependency is `lucide-react` for icons.

**Tech Stack:** WXT 0.20.27, React 19, TypeScript, Vitest + Testing Library (jsdom), `lucide-react`.

## Global Constraints

- Work from `extension/` for all commands (`npm test -- --run` for the suite, `npx tsc --noEmit` for type-checking — no lint script exists in this repo, `tsc --noEmit` is the established manual verification step).
- No Tailwind, no headless component library (Radix, etc.) — hand-built only. One new dependency total: `lucide-react`, pinned to exact version `1.23.0` (confirmed via `npm view lucide-react peerDependencies` to support React `^19.0.0`).
- Accent color is Indigo: `#4F46E5` (light) / `#818CF8` (dark) — user-confirmed over a Blue `#2563EB` alternative. Use these exact hex values.
- Dark mode is `@media (prefers-color-scheme: dark)` only — no manual toggle UI, no `chrome.storage` persistence, no toggle component this round.
- `--tn-primary` / `--tn-on-primary` are **permanent** semantic tokens (neutral high-contrast ink fill) — still used by `SegmentedControl`'s selected-pill state in the final design. Do **not** deprecate or remove them.
- `--tn-muted` **is** a deprecated alias for the new `--tn-text-muted` token, needed only during the migration window (kept from Task 2 through Task 11, removed in Task 12's cleanup once no raw `var(--tn-muted)` reference remains anywhere in `extension/entrypoints/sidepanel/`).
- Button accessible names must stay literal Chinese text — icons render with `aria-hidden="true"`, never icon-only + `aria-label`. Existing tests match buttons via `getByRole("button", { name: /regex/ })` against visible text content.
- `StepProgress`'s `data-state` attribute must stay on the same `<li>` element as today — the existing test walks up via `.closest("[data-state]")` from a text node.
- Numeric CSS-in-JS values (`fontSize`, `fontWeight`, `padding`, `gap`) stay as plain JS number/string literals matching the existing codebase's convention — do not introduce `var(--tn-text-*)`/`var(--tn-space-*)` inside inline `style={}` objects (TypeScript's `CSSProperties` types those as numeric-first and the existing code never does this); the new typography/spacing **tokens in `tokens.css` are still defined** and are consumed directly in real CSS (`.tn-markdown-view` rules), just not through inline styles.

---

### Task 1: Add `lucide-react` dependency

**Files:**
- Modify: `extension/package.json`

**Interfaces:**
- Produces: the `lucide-react` package available for import in all subsequent tasks (e.g. `import { Loader2 } from "lucide-react"`).

- [ ] **Step 1: Install the dependency**

Run: `cd extension && npm install lucide-react@1.23.0`
Expected: `package.json`'s `dependencies` gains `"lucide-react": "1.23.0"` (or `"^1.23.0"` — pin whatever `npm install` writes, as long as it resolves to exactly `1.23.0`), `package-lock.json` updated.

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd extension && node -e "require('lucide-react/dist/cjs/lucide-react.js')" 2>&1 | head -5 || echo "CJS check skipped (ESM-only package is fine)"`

This is a sanity check only — `lucide-react` is ESM-first and may not have a CJS entry; if the above prints nothing useful, that's fine. The real verification is Task 3's first component successfully importing and rendering a lucide icon.

- [ ] **Step 3: Run the existing suite to confirm no regressions from the install**

Run: `cd extension && npm test -- --run`
Expected: `14 passed | 1 skipped (57 tests)` or similar — same count as before, all green (adding a dependency shouldn't change any existing test outcome).

- [ ] **Step 4: Commit**

```bash
git add extension/package.json extension/package-lock.json
git commit -m "chore(extension): add lucide-react for the design-system icon set"
```

---

### Task 2: Rewrite `tokens.css`

**Files:**
- Modify: `extension/entrypoints/sidepanel/styles/tokens.css`

**Interfaces:**
- Produces (semantic CSS custom properties consumed by every later task): `--tn-bg`, `--tn-surface`, `--tn-surface-2`, `--tn-border`, `--tn-border-strong`, `--tn-text`, `--tn-text-muted`, `--tn-text-disabled`, `--tn-accent`, `--tn-accent-hover`, `--tn-accent-active`, `--tn-accent-subtle`, `--tn-on-accent`, `--tn-danger`, `--tn-danger-subtle`, `--tn-on-danger`, `--tn-focus-ring`, `--tn-primary` (permanent), `--tn-on-primary` (permanent), `--tn-muted` (deprecated alias for `--tn-text-muted`), `--tn-r-control`/`--tn-r-card`/`--tn-r-pill` (unchanged), plus primitive scales `--tn-gray-0..950`, `--tn-accent-50..800`, `--tn-red-400`/`--tn-red-600` (not consumed directly by components — internal to this file). Global classes: `.tn-app` (unchanged), `.tn-visually-hidden`, `.tn-spin`.

This task has no `.tsx` changes and no new tests of its own — it's pure CSS, verified by the existing suite staying green (jsdom doesn't meaningfully evaluate CSS custom property values, so no test currently asserts on them) and by a manual visual check deferred to Task 12.

- [ ] **Step 1: Replace the entire contents of `tokens.css`**

```css
:root {
  /* Primitive scale — internal to this file, never referenced directly by
     components. Semantic tokens below are the public API. */
  --tn-gray-0: #FFFFFF;
  --tn-gray-50: #FAFAFA;
  --tn-gray-100: #F5F5F5;
  --tn-gray-200: #E5E5E5;
  --tn-gray-300: #D4D4D4;
  --tn-gray-400: #A3A3A3;
  --tn-gray-500: #737373;
  --tn-gray-950: #0A0A0A;

  --tn-accent-50: #EEF2FF;
  --tn-accent-400: #818CF8;
  --tn-accent-600: #4F46E5;
  --tn-accent-700: #4338CA;
  --tn-accent-800: #3730A3;

  --tn-red-400: #F87171;
  --tn-red-600: #DC2626;

  /* Semantic tokens — light (default) */
  --tn-bg: var(--tn-gray-0);
  --tn-surface: var(--tn-gray-50);
  --tn-surface-2: var(--tn-gray-100);
  --tn-border: var(--tn-gray-200);
  --tn-border-strong: var(--tn-gray-300);
  --tn-text: var(--tn-gray-950);
  --tn-text-muted: var(--tn-gray-500);
  --tn-text-disabled: var(--tn-gray-400);

  --tn-accent: var(--tn-accent-600);
  --tn-accent-hover: var(--tn-accent-700);
  --tn-accent-active: var(--tn-accent-800);
  --tn-accent-subtle: var(--tn-accent-50);
  --tn-on-accent: var(--tn-gray-0);

  --tn-danger: var(--tn-red-600);
  --tn-danger-subtle: #FEF2F2;
  --tn-on-danger: var(--tn-gray-0);

  --tn-focus-ring: var(--tn-accent-600);

  /* Permanent neutral ink pair — used by SegmentedControl's selected state.
     Not deprecated; do not remove. */
  --tn-primary: var(--tn-gray-950);
  --tn-on-primary: var(--tn-gray-0);

  /* Deprecated alias — kept ONLY during the design-system migration (Task 2
     through Task 11), removed in Task 12's cleanup once no component
     references it directly anymore. Use --tn-text-muted in new code. */
  --tn-muted: var(--tn-text-muted);

  /* Typography scale (consumed directly in real CSS, e.g. .tn-markdown-view
     rules below — NOT inside inline style={} objects, see plan's Global
     Constraints). */
  --tn-font: system-ui, -apple-system, "Noto Sans TC", sans-serif;
  --tn-font-mono: ui-monospace, "SF Mono", Menlo, monospace;

  --tn-text-lg: 16px;
  --tn-text-lg-leading: 24px;
  --tn-text-xl: 20px;
  --tn-text-xl-leading: 28px;

  --tn-weight-semibold: 600;

  /* Spacing (4px grid, consumed directly in real CSS). */
  --tn-space-1: 4px;
  --tn-space-2: 8px;
  --tn-space-3: 12px;
  --tn-space-4: 16px;
  --tn-space-5: 20px;

  /* Radius — unchanged, already covers every use case. */
  --tn-r-control: 10px;
  --tn-r-card: 16px;
  --tn-r-pill: 9999px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --tn-bg: #0A0A0A;
    --tn-surface: #161616;
    --tn-surface-2: #1F1F1F;
    --tn-border: #2A2A2A;
    --tn-border-strong: #3D3D3D;
    --tn-text: #FAFAFA;
    --tn-text-muted: #A1A1A1;
    --tn-text-disabled: #6B6B6B;

    --tn-accent: var(--tn-accent-400);
    --tn-accent-hover: #A5B4FC;
    --tn-accent-active: #C7D2FE;
    --tn-accent-subtle: rgba(129, 140, 248, 0.16);
    --tn-on-accent: var(--tn-gray-950);

    --tn-danger: var(--tn-red-400);
    --tn-danger-subtle: rgba(248, 113, 113, 0.14);
    --tn-on-danger: var(--tn-gray-950);

    --tn-focus-ring: var(--tn-accent-400);

    --tn-primary: #FAFAFA;
    --tn-on-primary: var(--tn-gray-950);

    /* --tn-muted intentionally NOT redeclared here: its value is the raw
       token `var(--tn-text-muted)`, which is re-evaluated at point of use
       against whatever --tn-text-muted currently resolves to (this dark
       block's value) — no separate override needed. */
  }
}

.tn-app {
  font-family: var(--tn-font);
  color: var(--tn-text);
  background: var(--tn-bg);
  padding: 16px;
}

:focus-visible {
  outline: 2px solid var(--tn-focus-ring);
  outline-offset: 2px;
}

.tn-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes tn-spin {
  to { transform: rotate(360deg); }
}
.tn-spin {
  animation: tn-spin 0.8s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .tn-spin { animation: none; }
  * { transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 2: Run the existing suite to confirm nothing broke**

Run: `cd extension && npm test -- --run`
Expected: same pass count as Task 1's baseline — pure CSS change, no `.tsx` touched.

- [ ] **Step 3: Commit**

```bash
git add extension/entrypoints/sidepanel/styles/tokens.css
git commit -m "feat(extension): expand design tokens (spacing/typography/dark-mode/accent)"
```

---

### Task 3: Core `ui/` primitives (Spinner, Badge, Card, Button)

**Files:**
- Create: `extension/entrypoints/sidepanel/components/ui/Spinner.tsx`
- Create: `extension/entrypoints/sidepanel/components/ui/Badge.tsx`
- Create: `extension/entrypoints/sidepanel/components/ui/Card.tsx`
- Create: `extension/entrypoints/sidepanel/components/ui/Button.tsx`
- Test: `extension/tests/components/ui/Spinner.test.tsx`
- Test: `extension/tests/components/ui/Badge.test.tsx`
- Test: `extension/tests/components/ui/Card.test.tsx`
- Test: `extension/tests/components/ui/Button.test.tsx`

**Interfaces:**
- Produces:
  - `Spinner({ size?: number; label?: string })` — renders a spinning lucide `Loader2` (`aria-hidden`) plus visually-hidden label text.
  - `Badge({ children: ReactNode; variant?: "neutral" | "accent" })`.
  - `Card({ children: ReactNode; padding?: "sm" | "md"; as?: ElementType } & HTMLAttributes<HTMLElement>)` — forwards arbitrary native attributes (e.g. `role`) via `...rest`, used by Task 5's `ErrorState` to set `role="alert"`.
  - `Button({ variant?: "primary" | "outline" | "ghost"; size?: "sm" | "md"; icon?: LucideIcon; iconPosition?: "left" | "right"; fullWidth?: boolean; type?: "button" | "submit" } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">)`.
- Consumes: `lucide-react` (Task 1), `tokens.css`'s `--tn-*` tokens (Task 2).

None of these are wired into any existing screen yet — zero regression risk.

- [ ] **Step 1: Write the failing tests**

Create `extension/tests/components/ui/Spinner.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { Spinner } from "../../../entrypoints/sidepanel/components/ui/Spinner";

it("renders a visually-hidden label alongside the spinning icon", () => {
  render(<Spinner label="載入中" />);
  expect(screen.getByText("載入中")).toBeTruthy();
});
```

Create `extension/tests/components/ui/Badge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { Badge } from "../../../entrypoints/sidepanel/components/ui/Badge";

it("renders children and applies the accent variant color", () => {
  render(<Badge variant="accent">YouTube</Badge>);
  const badge = screen.getByText("YouTube");
  expect(badge.style.color).toBe("var(--tn-accent)");
});

it("defaults to the neutral variant", () => {
  render(<Badge>文章</Badge>);
  const badge = screen.getByText("文章");
  expect(badge.style.color).toBe("var(--tn-text-muted)");
});
```

Create `extension/tests/components/ui/Card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { Card } from "../../../entrypoints/sidepanel/components/ui/Card";

it("renders as a div by default and forwards extra attributes like role", () => {
  render(<Card role="alert">內容</Card>);
  expect(screen.getByRole("alert")).toHaveTextContent("內容");
});

it("renders as the element passed via `as`", () => {
  const { container } = render(<Card as="section">內容</Card>);
  expect(container.querySelector("section")).toBeTruthy();
});
```

Create `extension/tests/components/ui/Button.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { RotateCcw } from "lucide-react";
import { Button } from "../../../entrypoints/sidepanel/components/ui/Button";

it("renders children as the accessible name and handles clicks", () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>重試</Button>);
  const button = screen.getByRole("button", { name: "重試" });
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("renders an icon as aria-hidden so it never joins the accessible name", () => {
  render(
    <Button icon={RotateCcw} onClick={() => {}}>
      重試
    </Button>
  );
  const button = screen.getByRole("button", { name: "重試" });
  const icon = button.querySelector("svg");
  expect(icon).toHaveAttribute("aria-hidden", "true");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npm test -- --run tests/components/ui`
Expected: FAIL — `Cannot find module '.../components/ui/Spinner'` (and similarly for the other three; none of these files exist yet).

- [ ] **Step 3: Implement `Spinner.tsx`**

```tsx
import { Loader2 } from "lucide-react";

export interface SpinnerProps {
  size?: number;
  label?: string;
}

export function Spinner({ size = 20, label = "載入中" }: SpinnerProps) {
  return (
    <span style={{ display: "inline-flex", color: "var(--tn-accent)" }}>
      <Loader2 className="tn-spin" size={size} aria-hidden="true" />
      <span className="tn-visually-hidden">{label}</span>
    </span>
  );
}
```

- [ ] **Step 4: Implement `Badge.tsx`**

```tsx
import type { CSSProperties, ReactNode } from "react";

export interface BadgeProps {
  children: ReactNode;
  variant?: "neutral" | "accent";
}

const VARIANT_STYLE: Record<NonNullable<BadgeProps["variant"]>, CSSProperties> = {
  neutral: {
    border: "1px solid var(--tn-border)",
    color: "var(--tn-text-muted)",
    background: "transparent",
  },
  accent: {
    border: "1px solid transparent",
    color: "var(--tn-accent)",
    background: "var(--tn-accent-subtle)",
  },
};

export function Badge({ children, variant = "neutral" }: BadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        fontFamily: "var(--tn-font)",
        fontSize: 12,
        fontWeight: 500,
        padding: "2px 10px",
        borderRadius: "var(--tn-r-pill)",
        ...VARIANT_STYLE[variant],
      }}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 5: Implement `Card.tsx`**

```tsx
import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  padding?: "sm" | "md";
  as?: ElementType;
}

const PADDING: Record<NonNullable<CardProps["padding"]>, number> = {
  sm: 12,
  md: 16,
};

export function Card({
  children,
  padding = "md",
  as: Component = "div",
  style,
  ...rest
}: CardProps) {
  const cardStyle: CSSProperties = {
    background: "var(--tn-surface)",
    border: "1px solid var(--tn-border)",
    borderRadius: "var(--tn-r-card)",
    padding: PADDING[padding],
    fontFamily: "var(--tn-font)",
    color: "var(--tn-text)",
    ...style,
  };
  return (
    <Component style={cardStyle} {...rest}>
      {children}
    </Component>
  );
}
```

- [ ] **Step 6: Implement `Button.tsx`**

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
    background: "var(--tn-accent)",
    color: "var(--tn-on-accent)",
    border: "1px solid transparent",
  },
  outline: {
    background: "var(--tn-bg)",
    color: "var(--tn-text)",
    border: "1px solid var(--tn-border)",
  },
  ghost: {
    background: "transparent",
    color: "var(--tn-text)",
    border: "1px solid transparent",
  },
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
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
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

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd extension && npm test -- --run tests/components/ui`
Expected: PASS (all 6 new tests green).

- [ ] **Step 8: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add extension/entrypoints/sidepanel/components/ui/Spinner.tsx \
        extension/entrypoints/sidepanel/components/ui/Badge.tsx \
        extension/entrypoints/sidepanel/components/ui/Card.tsx \
        extension/entrypoints/sidepanel/components/ui/Button.tsx \
        extension/tests/components/ui/
git commit -m "feat(extension): add Spinner/Badge/Card/Button ui primitives"
```

---

### Task 4: Form `ui/` primitives (FormField, TextInput, Select, SegmentedControl, Toggle)

**Files:**
- Create: `extension/entrypoints/sidepanel/components/ui/FormField.tsx`
- Create: `extension/entrypoints/sidepanel/components/ui/TextInput.tsx`
- Create: `extension/entrypoints/sidepanel/components/ui/Select.tsx`
- Create: `extension/entrypoints/sidepanel/components/ui/SegmentedControl.tsx`
- Create: `extension/entrypoints/sidepanel/components/ui/Toggle.tsx`
- Create: `extension/entrypoints/sidepanel/components/ui/index.ts` (barrel export)
- Test: `extension/tests/components/ui/FormField.test.tsx`
- Test: `extension/tests/components/ui/Select.test.tsx`
- Test: `extension/tests/components/ui/SegmentedControl.test.tsx`
- Test: `extension/tests/components/ui/Toggle.test.tsx`

**Interfaces:**
- Produces:
  - `FormField({ label: string; children: ReactNode; htmlFor?: string })`.
  - `TextInput` — a `forwardRef`-wrapped `<input>` accepting all native `InputHTMLAttributes<HTMLInputElement>`.
  - `SelectOption = { value: string; label: string }`; `Select({ options: SelectOption[]; placeholder?: string } & Omit<SelectHTMLAttributes<HTMLSelectElement>, "children">)`.
  - `SegmentedControlOption = { value: string; label: string }`; `SegmentedControl({ options: SegmentedControlOption[]; value: string; onChange: (value: string) => void; ariaLabel: string })`.
  - `Toggle({ checked: boolean; onChange: (next: boolean) => void; ariaLabel: string; id?: string })` — renders a real `<button role="switch" aria-checked>`.
- Consumes: `tokens.css` tokens (Task 2); `--tn-primary`/`--tn-on-primary` for `SegmentedControl`'s selected pill (per Global Constraints — these are permanent, not deprecated).

Still unwired — zero regression risk. `TextInput` has no dedicated test (it's a thin, fully-native `<input>` wrapper with no branching logic; its behavior is exercised end-to-end once `SettingsForm` adopts it in Task 9).

- [ ] **Step 1: Write the failing tests**

Create `extension/tests/components/ui/FormField.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { FormField } from "../../../entrypoints/sidepanel/components/ui/FormField";

it("associates the label with its control via native label wrapping", () => {
  render(
    <FormField label="方向">
      <input aria-label="方向" defaultValue="" />
    </FormField>
  );
  expect(screen.getByText("方向")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "方向" })).toBeTruthy();
});
```

Create `extension/tests/components/ui/Select.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { Select } from "../../../entrypoints/sidepanel/components/ui/Select";

it("renders a placeholder option and calls onChange when an option is picked", () => {
  const onChange = vi.fn();
  render(
    <Select
      placeholder="選擇方法論"
      value=""
      onChange={onChange}
      options={[{ value: "m1", label: "方法論一" }]}
    />
  );
  const select = screen.getByDisplayValue("選擇方法論");
  fireEvent.change(select, { target: { value: "m1" } });
  expect(onChange).toHaveBeenCalledTimes(1);
});
```

Create `extension/tests/components/ui/SegmentedControl.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { SegmentedControl } from "../../../entrypoints/sidepanel/components/ui/SegmentedControl";

it("marks the active option as pressed and calls onChange on click", () => {
  const onChange = vi.fn();
  render(
    <SegmentedControl
      ariaLabel="模式"
      value="concise"
      onChange={onChange}
      options={[
        { value: "concise", label: "精簡" },
        { value: "detailed", label: "詳細" },
      ]}
    />
  );
  expect(screen.getByRole("button", { name: "精簡" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "詳細" })).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(screen.getByRole("button", { name: "詳細" }));
  expect(onChange).toHaveBeenCalledWith("detailed");
});
```

Create `extension/tests/components/ui/Toggle.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "../../../entrypoints/sidepanel/components/ui/Toggle";

it("renders as a real button with role=switch and toggles on click", () => {
  const onChange = vi.fn();
  render(<Toggle ariaLabel="查證上網" checked={false} onChange={onChange} />);

  const toggle = screen.getByRole("switch", { name: "查證上網" });
  expect(toggle.tagName).toBe("BUTTON");
  expect(toggle).toHaveAttribute("aria-checked", "false");

  fireEvent.click(toggle);
  expect(onChange).toHaveBeenCalledWith(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npm test -- --run tests/components/ui`
Expected: the 4 new test files FAIL (`Cannot find module`); the 6 tests from Task 3 still PASS.

- [ ] **Step 3: Implement `FormField.tsx`**

```tsx
import type { ReactNode } from "react";

export interface FormFieldProps {
  label: string;
  children: ReactNode;
  htmlFor?: string;
}

export function FormField({ label, children, htmlFor }: FormFieldProps) {
  return (
    <label htmlFor={htmlFor} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span
        style={{
          fontFamily: "var(--tn-font)",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--tn-text-muted)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
```

- [ ] **Step 4: Implement `TextInput.tsx`**

```tsx
import { forwardRef, type InputHTMLAttributes } from "react";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { style, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      style={{
        fontFamily: "var(--tn-font)",
        fontSize: 14,
        color: "var(--tn-text)",
        background: "var(--tn-bg)",
        border: "1px solid var(--tn-border)",
        borderRadius: "var(--tn-r-control)",
        padding: "8px 12px",
        width: "100%",
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    />
  );
});
```

- [ ] **Step 5: Implement `Select.tsx`**

```tsx
import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: SelectOption[];
  placeholder?: string;
}

export function Select({ options, placeholder, style, ...rest }: SelectProps) {
  return (
    <div style={{ position: "relative" }}>
      <select
        style={{
          fontFamily: "var(--tn-font)",
          fontSize: 14,
          color: "var(--tn-text)",
          background: "var(--tn-bg)",
          border: "1px solid var(--tn-border)",
          borderRadius: "var(--tn-r-control)",
          padding: "8px 32px 8px 12px",
          width: "100%",
          boxSizing: "border-box",
          appearance: "none",
          ...style,
        }}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        aria-hidden="true"
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: "var(--tn-text-muted)",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 6: Implement `SegmentedControl.tsx`**

```tsx
export interface SegmentedControlOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

export function SegmentedControl({ options, value, onChange, ariaLabel }: SegmentedControlProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        border: "1px solid var(--tn-border)",
        borderRadius: "var(--tn-r-pill)",
        padding: 4,
        gap: 4,
        width: "fit-content",
      }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            style={{
              fontFamily: "var(--tn-font)",
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              borderRadius: "var(--tn-r-pill)",
              padding: "6px 16px",
              cursor: "pointer",
              background: active ? "var(--tn-primary)" : "transparent",
              color: active ? "var(--tn-on-primary)" : "var(--tn-text)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: Implement `Toggle.tsx`**

```tsx
export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  id?: string;
}

export function Toggle({ checked, onChange, ariaLabel, id }: ToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
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
    >
      {/* Knob is deliberately always --tn-gray-0 (pure white) regardless of
          light/dark mode or on/off state — matches the platform-convention
          toggle-knob look (iOS-style), and stays visible against both the
          neutral --tn-border track and the colored --tn-accent track in
          both themes (unlike --tn-on-accent, which flips to near-black in
          dark mode for text-on-accent contrast — the wrong effect here). */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 20,
          height: 20,
          borderRadius: "var(--tn-r-pill)",
          background: "var(--tn-gray-0)",
          transition: "left 0.15s ease",
        }}
      />
    </button>
  );
}
```

- [ ] **Step 8: Create the barrel export `index.ts`**

```ts
export { Spinner } from "./Spinner";
export { Badge } from "./Badge";
export { Card } from "./Card";
export { Button } from "./Button";
export { FormField } from "./FormField";
export { TextInput } from "./TextInput";
export { Select } from "./Select";
export { SegmentedControl } from "./SegmentedControl";
export { Toggle } from "./Toggle";
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd extension && npm test -- --run tests/components/ui`
Expected: PASS (10 tests total across Tasks 3+4).

- [ ] **Step 10: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 11: Commit**

```bash
git add extension/entrypoints/sidepanel/components/ui/
git commit -m "feat(extension): add FormField/TextInput/Select/SegmentedControl/Toggle ui primitives"
```

---

### Task 5: `ErrorState` component

**Files:**
- Create: `extension/entrypoints/sidepanel/components/ErrorState.tsx`
- Test: `extension/tests/components/ErrorState.test.tsx`

**Interfaces:**
- Consumes: `Card`, `Button` (Task 3).
- Produces: `ErrorState({ title: string; message: string; hint?: string; onRetry?: () => void; retryLabel?: string })` — renders with `role="alert"` so screen readers announce it immediately when it mounts (a genuine accessibility improvement over today's silent error boxes), without needing a broader `aria-live` region that would also (wrongly) announce every streamed markdown delta on the results page.

Still unwired — zero regression risk.

- [ ] **Step 1: Write the failing test**

Create `extension/tests/components/ErrorState.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "../../entrypoints/sidepanel/components/ErrorState";

it("renders as role=alert with title/message and calls onRetry when the retry button is clicked", () => {
  const onRetry = vi.fn();
  render(
    <ErrorState
      title="擷取失敗"
      message="無法讀取字幕，請開啟字幕面板後重試。"
      hint="請重新整理頁面或換一個頁面後再試。"
      onRetry={onRetry}
    />
  );

  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("擷取失敗");
  expect(alert).toHaveTextContent("無法讀取字幕，請開啟字幕面板後重試。");
  expect(alert).toHaveTextContent("請重新整理頁面或換一個頁面後再試。");

  fireEvent.click(screen.getByRole("button", { name: /重試/ }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("omits the retry button when onRetry is not provided", () => {
  render(<ErrorState title="錯誤" message="訊息" />);
  expect(screen.queryByRole("button")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm test -- --run tests/components/ErrorState.test.tsx`
Expected: FAIL — `Cannot find module '.../components/ErrorState'`.

- [ ] **Step 3: Implement `ErrorState.tsx`**

```tsx
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export interface ErrorStateProps {
  title: string;
  message: string;
  hint?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({ title, message, hint, onRetry, retryLabel = "重試" }: ErrorStateProps) {
  return (
    <Card role="alert">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          textAlign: "center",
          padding: "16px 0",
        }}
      >
        <CircleAlert size={24} aria-hidden="true" style={{ color: "var(--tn-danger)" }} />
        <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--tn-text)" }}>{title}</p>
        <p style={{ margin: 0, fontSize: 14, color: "var(--tn-text-muted)" }}>{message}</p>
        {hint && <p style={{ margin: 0, fontSize: 13, color: "var(--tn-text-muted)" }}>{hint}</p>}
        {onRetry && (
          <Button variant="primary" icon={RotateCcw} onClick={onRetry} style={{ marginTop: 8 }}>
            {retryLabel}
          </Button>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npm test -- --run tests/components/ErrorState.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/entrypoints/sidepanel/components/ErrorState.tsx extension/tests/components/ErrorState.test.tsx
git commit -m "feat(extension): add ErrorState component with retry affordance"
```

---

### Task 6: Migrate `CopyButton.tsx`

**Files:**
- Modify: `extension/entrypoints/sidepanel/components/CopyButton.tsx`

**Interfaces:**
- Consumes: `Button` (Task 3).
- No public interface change — `CopyButtonProps` is unchanged.

No dedicated test file exists for `CopyButton`; it's exercised indirectly via `App.test.tsx`'s `getByRole("button", { name: /複製/ })` assertion (Task 11 confirms this still passes end-to-end, but verify it here too since this is the first task touching a component `App.test.tsx` depends on).

- [ ] **Step 1: Replace the file contents**

```tsx
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
```

- [ ] **Step 2: Run the full suite (no dedicated test file — verify via `App.test.tsx`)**

Run: `cd extension && npm test -- --run tests/components/App.test.tsx`
Expected: PASS — specifically the test `"transitions to result page on 開始, streams steps, and finishes with markdown + copy"`, which asserts `screen.getByRole("button", { name: /複製/ })` exists after streaming completes.

- [ ] **Step 3: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add extension/entrypoints/sidepanel/components/CopyButton.tsx
git commit -m "refactor(extension): migrate CopyButton onto the Button primitive"
```

---

### Task 7: Migrate `StepProgress.tsx`

**Files:**
- Modify: `extension/entrypoints/sidepanel/components/StepProgress.tsx`

**Interfaces:** No prop-shape change — `StepProgressProps` unchanged. Only the color source and `--tn-muted` reference change.

- [ ] **Step 1: Replace the file contents**

```tsx
import type { CSSProperties } from "react";
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
  opacity: state === "active" ? 1 : state === "done" ? 0.6 : 1,
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
            <span aria-hidden="true" style={dotStyle(state)} />
            <span>{STEP_LABELS[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: Run the dedicated test to verify it still passes**

Run: `cd extension && npm test -- --run tests/components/StepProgress.test.tsx`
Expected: PASS — the test only checks `data-state` attribute values and label text, both unchanged in shape (only the color source changed).

- [ ] **Step 3: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add extension/entrypoints/sidepanel/components/StepProgress.tsx
git commit -m "refactor(extension): recolor StepProgress dots to the accent token"
```

---

### Task 8: Migrate `ExtractCard.tsx`

**Files:**
- Modify: `extension/entrypoints/sidepanel/components/ExtractCard.tsx`

**Interfaces:**
- Consumes: `Card`, `Badge` (Task 3).
- No prop-shape change — `ExtractCardProps` unchanged.

- [ ] **Step 1: Replace the file contents**

```tsx
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
```

- [ ] **Step 2: Run the dedicated test to verify it still passes**

Run: `cd extension && npm test -- --run tests/components/ExtractCard.test.tsx`
Expected: PASS — the test queries by text content only (title, char count substring, preview text), all unchanged.

- [ ] **Step 3: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add extension/entrypoints/sidepanel/components/ExtractCard.tsx
git commit -m "refactor(extension): migrate ExtractCard onto Card/Badge primitives"
```

---

### Task 9: Migrate `SettingsForm.tsx` + add its first test file

**Files:**
- Modify: `extension/entrypoints/sidepanel/components/SettingsForm.tsx`
- Create: `extension/tests/components/SettingsForm.test.tsx`

**Interfaces:**
- Consumes: `FormField`, `Select`, `TextInput`, `SegmentedControl`, `Toggle` (Task 4).
- No prop-shape change — `SettingsFormProps`/`SettingsFormValue`/`Methodology` unchanged.

This is the one component with **zero existing test coverage** today, and the `Toggle` migration is the one place getting a real DOM-node-type change (`<span role="switch" tabIndex={0}>` → `<button role="switch">`) — so this task adds real coverage, not just a regression check.

- [ ] **Step 1: Write the failing tests**

Create `extension/tests/components/SettingsForm.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsForm, type SettingsFormValue } from "../../entrypoints/sidepanel/components/SettingsForm";

const methodologies = [
  { id: "m1", name: "方法論一", categories: ["youtube"] },
  { id: "m2", name: "方法論二", categories: ["article"] },
];

const baseValue: SettingsFormValue = {
  methodology_id: "",
  mode: "concise",
  direction: "",
  web_search: false,
};

it("renders methodology options and calls onChange when one is selected", () => {
  const onChange = vi.fn();
  render(<SettingsForm methodologies={methodologies} value={baseValue} onChange={onChange} />);

  fireEvent.change(screen.getByDisplayValue("選擇方法論"), { target: { value: "m2" } });
  expect(onChange).toHaveBeenCalledWith({ ...baseValue, methodology_id: "m2" });
});

it("updates the direction text input", () => {
  const onChange = vi.fn();
  render(<SettingsForm methodologies={methodologies} value={baseValue} onChange={onChange} />);

  fireEvent.change(screen.getByPlaceholderText("例如：聚焦於實作細節"), {
    target: { value: "聚焦架構" },
  });
  expect(onChange).toHaveBeenCalledWith({ ...baseValue, direction: "聚焦架構" });
});

it("switches mode via the segmented control", () => {
  const onChange = vi.fn();
  render(<SettingsForm methodologies={methodologies} value={baseValue} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "詳細" }));
  expect(onChange).toHaveBeenCalledWith({ ...baseValue, mode: "detailed" });
});

it("renders the web-search toggle as a real switch button and toggles on click", () => {
  const onChange = vi.fn();
  render(<SettingsForm methodologies={methodologies} value={baseValue} onChange={onChange} />);

  const toggle = screen.getByRole("switch", { name: "查證上網" });
  expect(toggle.tagName).toBe("BUTTON");
  expect(toggle).toHaveAttribute("aria-checked", "false");

  fireEvent.click(toggle);
  expect(onChange).toHaveBeenCalledWith({ ...baseValue, web_search: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npm test -- --run tests/components/SettingsForm.test.tsx`
Expected: FAIL — current `SettingsForm` renders a `<span role="switch">`, not a `<button>`, so the toggle test fails on `toggle.tagName` at minimum; other assertions may pass already against the old implementation (that's fine — the goal is the file being replaced, not every assertion starting red).

- [ ] **Step 3: Replace `SettingsForm.tsx`'s contents**

```tsx
import type { Mode } from "../lib/types";
import { FormField } from "./ui/FormField";
import { Select } from "./ui/Select";
import { TextInput } from "./ui/TextInput";
import { SegmentedControl } from "./ui/SegmentedControl";
import { Toggle } from "./ui/Toggle";

export interface Methodology {
  id: string;
  name: string;
  description?: string;
  categories?: string[];
}

export interface SettingsFormValue {
  methodology_id: string;
  mode: Mode;
  direction: string;
  web_search: boolean;
}

export interface SettingsFormProps {
  methodologies: Methodology[];
  value: SettingsFormValue;
  onChange: (value: SettingsFormValue) => void;
}

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "concise", label: "精簡" },
  { value: "detailed", label: "詳細" },
];

const labelStyle = {
  fontFamily: "var(--tn-font)",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--tn-text-muted)",
};

export function SettingsForm({ methodologies, value, onChange }: SettingsFormProps) {
  function update(patch: Partial<SettingsFormValue>) {
    onChange({ ...value, ...patch });
  }

  return (
    <form
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        fontFamily: "var(--tn-font)",
        color: "var(--tn-text)",
      }}
      onSubmit={(e) => e.preventDefault()}
    >
      <FormField label="方法論">
        <Select
          placeholder="選擇方法論"
          value={value.methodology_id}
          onChange={(e) => update({ methodology_id: e.target.value })}
          options={methodologies.map((m) => ({ value: m.id, label: m.name }))}
        />
      </FormField>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={labelStyle}>模式</span>
        <SegmentedControl
          ariaLabel="模式"
          options={MODE_OPTIONS}
          value={value.mode}
          onChange={(next) => update({ mode: next as Mode })}
        />
      </div>

      <FormField label="方向">
        <TextInput
          type="text"
          value={value.direction}
          placeholder="例如：聚焦於實作細節"
          onChange={(e) => update({ direction: e.target.value })}
        />
      </FormField>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={labelStyle}>查證上網</span>
        <Toggle
          ariaLabel="查證上網"
          checked={value.web_search}
          onChange={(next) => update({ web_search: next })}
        />
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && npm test -- --run tests/components/SettingsForm.test.tsx`
Expected: PASS (all 4 tests green).

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/entrypoints/sidepanel/components/SettingsForm.tsx extension/tests/components/SettingsForm.test.tsx
git commit -m "refactor(extension): migrate SettingsForm onto ui primitives, add first test coverage"
```

---

### Task 10: `.tn-markdown-view` typography CSS

**Files:**
- Modify: `extension/entrypoints/sidepanel/styles/tokens.css`

**Interfaces:** No `.tsx` change — `MarkdownView.tsx`'s `className="tn-markdown-view"` already exists and currently matches zero CSS rules (verified by reading the file: only inline `font-family`/`color`/`font-size`/`line-height` are set on the container).

- [ ] **Step 1: Append the following to the end of `tokens.css`**

```css
.tn-markdown-view h1,
.tn-markdown-view h2 {
  font-size: var(--tn-text-xl);
  font-weight: var(--tn-weight-semibold);
  line-height: var(--tn-text-xl-leading);
  margin: var(--tn-space-4) 0 var(--tn-space-2);
}

.tn-markdown-view h3,
.tn-markdown-view h4 {
  font-size: var(--tn-text-lg);
  font-weight: var(--tn-weight-semibold);
  line-height: var(--tn-text-lg-leading);
  margin: var(--tn-space-4) 0 var(--tn-space-2);
}

.tn-markdown-view p {
  margin: 0 0 var(--tn-space-3);
}

.tn-markdown-view code {
  font-family: var(--tn-font-mono);
  background: var(--tn-surface-2);
  border-radius: var(--tn-r-control);
  padding: 2px 6px;
  font-size: 0.9em;
}

.tn-markdown-view pre {
  font-family: var(--tn-font-mono);
  background: var(--tn-surface-2);
  border-radius: var(--tn-r-control);
  padding: var(--tn-space-3);
  overflow-x: auto;
}

.tn-markdown-view pre code {
  background: none;
  padding: 0;
}

.tn-markdown-view a {
  color: var(--tn-accent);
  text-decoration: underline;
}

.tn-markdown-view blockquote {
  border-left: 2px solid var(--tn-border-strong);
  color: var(--tn-text-muted);
  padding-left: var(--tn-space-3);
  margin: var(--tn-space-3) 0;
}

.tn-markdown-view ul,
.tn-markdown-view ol {
  padding-left: var(--tn-space-5);
  margin: 0 0 var(--tn-space-3);
}

.tn-markdown-view li + li {
  margin-top: var(--tn-space-1);
}
```

- [ ] **Step 2: Run the dedicated test to verify it still passes**

Run: `cd extension && npm test -- --run tests/components/MarkdownView.test.tsx`
Expected: PASS — the test only checks for a rendered `<h1>` and sanitization of dangerous HTML, both unaffected by a pure CSS addition.

- [ ] **Step 3: Run the full suite**

Run: `cd extension && npm test -- --run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add extension/entrypoints/sidepanel/styles/tokens.css
git commit -m "feat(extension): add typography rules for rendered markdown notes"
```

---

### Task 11: Migrate `App.tsx` (the one behavior-touching task)

**Files:**
- Modify: `extension/entrypoints/sidepanel/App.tsx`
- Modify: `extension/tests/components/App.test.tsx`

**Interfaces:**
- Consumes: `Spinner`, `Button` (Task 3), `ErrorState` (Task 5).
- Produces: `App`'s exported `AppDeps`/`MethodologySummary` interfaces are **unchanged**. Internally, the inline extract-on-mount logic becomes a named `runExtract()` closure (not exported — internal to `App`) so both the mount effect and the retry button can call it.

Everything up to this task has been pure presentation. This is the one task with an actual logic change: extracting `runExtract()` and wiring two retry buttons.

- [ ] **Step 1: Write the failing tests (append to the existing file)**

Add to `extension/tests/components/App.test.tsx` (the file already imports `render, screen, waitFor, fireEvent` and defines `extractResult`, `methodologies`, `happyPathEvents`, `errorMidStreamEvents`, `makeDeps` — reuse them, do not redefine):

```tsx
it("retries extraction from extract_error via the retry button", async () => {
  const failResult = {
    ok: false,
    category: "article" as const,
    content: { title: "", url: "https://example.com", text: "", metadata: null },
    error: { code: "extract_failed", message: "無法讀取字幕，請開啟字幕面板後重試。" },
  };
  const extract = vi.fn().mockResolvedValueOnce(failResult).mockResolvedValueOnce(extractResult);
  const deps = makeDeps({ extract });
  render(<App deps={deps} />);

  expect(await screen.findByText(/無法讀取字幕/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /重試/ }));

  expect(await screen.findByText("測試影片標題")).toBeTruthy();
  expect(extract).toHaveBeenCalledTimes(2);
});

it("retries the stream from stream_error via the retry button", async () => {
  const process = vi
    .fn()
    .mockImplementationOnce(() => errorMidStreamEvents())
    .mockImplementationOnce(() => happyPathEvents());
  const deps = makeDeps({ process });
  render(<App deps={deps} />);

  await screen.findByText("測試影片標題");
  fireEvent.click(screen.getByRole("button", { name: /開始/ }));

  expect(await screen.findByText(/上游服務錯誤/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /重試/ }));

  await waitFor(() => {
    expect(screen.getByText("這是內容第一段。")).toBeTruthy();
  });
  expect(process).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npm test -- --run tests/components/App.test.tsx`
Expected: FAIL — the current `App.tsx` renders no "重試"-named button anywhere, so `screen.getByRole("button", { name: /重試/ })` throws.

- [ ] **Step 3: Replace `App.tsx`'s contents**

```tsx
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Sparkles } from "lucide-react";
import { ExtractCard } from "./components/ExtractCard";
import { SettingsForm, type SettingsFormValue } from "./components/SettingsForm";
import { StepProgress } from "./components/StepProgress";
import { MarkdownView } from "./components/MarkdownView";
import { CopyButton } from "./components/CopyButton";
import { ErrorState } from "./components/ErrorState";
import { Spinner } from "./components/ui/Spinner";
import { Button } from "./components/ui/Button";
import type { ExtractResult, NoteRequest, SseEvent, StepName } from "./lib/types";

export interface MethodologySummary {
  id: string;
  name: string;
  categories: string[];
}

export interface AppDeps {
  loadMethodologies(): Promise<MethodologySummary[]>;
  extract(): Promise<ExtractResult>;
  process(req: NoteRequest): AsyncIterable<SseEvent>;
}

type AppState =
  | { phase: "extracting" }
  | { phase: "extract_error"; error: { code: string; message: string } }
  | { phase: "ready"; result: ExtractResult }
  | { phase: "streaming"; result: ExtractResult }
  | { phase: "done"; result: ExtractResult }
  | { phase: "stream_error"; result: ExtractResult; error: { code: string; message: string } };

const STEP_ORDER: StepName[] = ["structure", "draft", "augment", "verify", "format"];

const DEFAULT_SETTINGS: SettingsFormValue = {
  methodology_id: "",
  mode: "concise",
  direction: "",
  web_search: false,
};

const pageStyle: React.CSSProperties = {
  fontFamily: "var(--tn-font)",
  color: "var(--tn-text)",
  background: "var(--tn-bg)",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: 16,
};

export function App({ deps }: { deps: AppDeps }) {
  const [state, setState] = useState<AppState>({ phase: "extracting" });
  const [methodologies, setMethodologies] = useState<MethodologySummary[]>([]);
  const [settings, setSettings] = useState<SettingsFormValue>(DEFAULT_SETTINGS);
  const [activeStep, setActiveStep] = useState<StepName | null>(null);
  const [doneSteps, setDoneSteps] = useState<StepName[]>([]);
  const [streamedMarkdown, setStreamedMarkdown] = useState("");
  const [finalMarkdown, setFinalMarkdown] = useState<string | null>(null);

  // Guards against a stale async run (e.g. a second 開始 click) clobbering
  // state from a still-in-flight previous stream.
  const runIdRef = useRef(0);

  function runExtract() {
    setState({ phase: "extracting" });
    deps
      .extract()
      .then((result) => {
        if (result.ok) {
          setState({ phase: "ready", result });
        } else {
          setState({
            phase: "extract_error",
            error: result.error ?? { code: "extract_failed", message: "擷取失敗" },
          });
        }
      })
      .catch((err) => {
        setState({
          phase: "extract_error",
          error: { code: "extract_failed", message: err instanceof Error ? err.message : String(err) },
        });
      });
  }

  useEffect(() => {
    runExtract();

    deps
      .loadMethodologies()
      .then((list) => setMethodologies(list))
      .catch(() => setMethodologies([]));
    // deps is provided once by the caller (App is re-mounted, not re-rendered, when deps change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStart() {
    if (state.phase !== "ready") return;
    const result = state.result;
    const runId = ++runIdRef.current;

    const req: NoteRequest = {
      category: result.category,
      methodology_id: settings.methodology_id,
      mode: settings.mode,
      direction: settings.direction,
      provider: "gemini",
      web_search: settings.web_search,
      content: result.content,
    };

    setActiveStep(null);
    setDoneSteps([]);
    setStreamedMarkdown("");
    setFinalMarkdown(null);
    setState({ phase: "streaming", result });

    try {
      for await (const evt of deps.process(req)) {
        if (runIdRef.current !== runId) return; // superseded by a newer run

        switch (evt.event) {
          case "step": {
            if (evt.data.status === "start") {
              setActiveStep(evt.data.step);
            } else {
              setDoneSteps((prev) => (prev.includes(evt.data.step) ? prev : [...prev, evt.data.step]));
              setActiveStep((curr) => (curr === evt.data.step ? null : curr));
            }
            break;
          }
          case "delta": {
            setStreamedMarkdown((prev) => prev + evt.data.text);
            break;
          }
          case "citations": {
            // Citations are not rendered in this slice.
            break;
          }
          case "done": {
            setFinalMarkdown(evt.data.markdown);
            setDoneSteps(STEP_ORDER);
            setActiveStep(null);
            setState({ phase: "done", result });
            break;
          }
          case "error": {
            setState({ phase: "stream_error", result, error: evt.data });
            return;
          }
        }
      }
    } catch (err) {
      if (runIdRef.current !== runId) return;
      setState({
        phase: "stream_error",
        result,
        error: { code: "stream_failed", message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  function handleBack() {
    if (state.phase !== "done" && state.phase !== "stream_error" && state.phase !== "streaming") return;
    runIdRef.current += 1; // invalidate any in-flight stream
    setState({ phase: "ready", result: state.result });
  }

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

  if (state.phase === "extract_error") {
    return (
      <div className="tn-app" style={pageStyle}>
        <ErrorState
          title="擷取失敗"
          message={state.error.message}
          hint="請重新整理頁面或換一個頁面後再試。"
          onRetry={runExtract}
        />
      </div>
    );
  }

  if (state.phase === "ready") {
    return (
      <div className="tn-app" style={pageStyle}>
        <ExtractCard result={state.result} />
        <SettingsForm methodologies={methodologies} value={settings} onChange={setSettings} />
        <Button variant="primary" icon={Sparkles} fullWidth onClick={handleStart}>
          開始處理
        </Button>
      </div>
    );
  }

  // Result page: streaming | done | stream_error
  const markdownToShow = finalMarkdown ?? streamedMarkdown;

  return (
    <div className="tn-app" style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={handleBack}>
          返回
        </Button>
        {state.phase === "done" && <CopyButton text={markdownToShow} />}
      </div>

      <StepProgress active={activeStep} doneSteps={doneSteps} />

      {state.phase === "stream_error" && (
        <ErrorState title="串流發生錯誤" message={state.error.message} onRetry={handleStart} />
      )}

      <MarkdownView markdown={markdownToShow} />
    </div>
  );
}

export default App;
```

Note: `role="status" aria-live="polite"` stays only on the `extracting` phase's static status block (announces "擷取中…" once, safely — its content never changes rapidly). It is deliberately **not** placed on the results-page header or any container that also holds `MarkdownView`'s streamed content — a live region wrapping continuously-updating streamed text would re-announce every delta chunk to screen readers, which would be actively disruptive. `ErrorState`'s own `role="alert"` (Task 5) already handles announcing both error phases without this problem, since it's rendered once per error, not on every re-render.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && npm test -- --run tests/components/App.test.tsx`
Expected: PASS — all 6 tests (4 existing + 2 new retry cases).

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS, no type errors, no regressions in any other file.

- [ ] **Step 6: Commit**

```bash
git add extension/entrypoints/sidepanel/App.tsx extension/tests/components/App.test.tsx
git commit -m "refactor(extension): migrate App.tsx onto ui primitives, add retry affordance"
```

---

### Task 12: Cleanup — remove the deprecated `--tn-muted` alias, final verification

**Files:**
- Modify: `extension/entrypoints/sidepanel/styles/tokens.css`

**Interfaces:** None — this is a deletion-only cleanup once nothing references `--tn-muted` anymore. `--tn-primary`/`--tn-on-primary` are **not** touched (they're permanent, still used by `SegmentedControl`).

- [ ] **Step 1: Grep for any remaining `--tn-muted` reference**

Run: `cd extension && grep -rn -- "--tn-muted" entrypoints/sidepanel/`
Expected: only one match — the alias declaration itself in `tokens.css` (`--tn-muted: var(--tn-text-muted);`). If any `.tsx` file still references `var(--tn-muted)`, that file was missed in an earlier task — stop and fix it there instead of proceeding (do not delete the alias while it's still in use).

- [ ] **Step 2: Remove the deprecated alias from `tokens.css`**

Delete this line (and its explanatory comment) from the `:root` block:

```css
  /* Deprecated alias — kept ONLY during the design-system migration (Task 2
     through Task 11), removed in Task 12's cleanup once no component
     references it directly anymore. Use --tn-text-muted in new code. */
  --tn-muted: var(--tn-text-muted);
```

- [ ] **Step 3: Run the full suite and type-check**

Run: `cd extension && npm test -- --run && npx tsc --noEmit`
Expected: PASS — every test file, no type errors. This is the final automated verification gate for the whole plan.

- [ ] **Step 4: Commit**

```bash
git add extension/entrypoints/sidepanel/styles/tokens.css
git commit -m "chore(extension): remove deprecated --tn-muted alias, migration complete"
```

- [ ] **Step 5: Manual smoke test (you do this — requires a real Chrome browser, cannot be scripted)**

1. `cd extension && npm run build` (or `npm run dev` for WXT dev mode).
2. Load the unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked → select `extension/.output/chrome-mv3` or the dev output directory).
3. Open the side panel on a real page (article, YouTube video, or Coursera lecture).
4. Confirm: loading spinner appears during extraction; the `ready` screen renders with the new token colors and lucide icons (no `▶`/`‹`/`⧉` unicode glyphs anywhere); trigger a note generation and confirm `StepProgress` dots turn indigo as steps complete; confirm `CopyButton` works and shows the check-icon state.
5. Toggle macOS/OS Appearance between Light and Dark while the side panel is open (or reopen it after switching) — confirm every screen re-renders with the dark-mode token values (near-black background, light indigo accent) with no unstyled/broken elements.
6. Tab through every interactive control with the keyboard only (no mouse) — confirm a visible focus ring (indigo outline) appears on every button, input, select, and the toggle switch.
7. Trigger both error paths if possible (e.g. temporarily break the backend URL, or use a page type that fails extraction) and confirm the retry button in `ErrorState` actually re-triggers extraction / re-triggers the stream.

## Verification

- `cd extension && npm test -- --run` after every task — should stay green throughout except for the deliberately-red-then-green cycles in Tasks 3, 4, 5, 9, and 11.
- `cd extension && npx tsc --noEmit` after every task that touches `.tsx` — no type errors at any point.
- Final grep check (Task 12, Step 1) that no `var(--tn-muted)` reference remains before deleting the alias.
- Manual Chrome smoke test (Task 12, Step 5) — the only step that can't be scripted; covers dark mode, keyboard focus rings, and both retry paths end-to-end.
