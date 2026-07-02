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
