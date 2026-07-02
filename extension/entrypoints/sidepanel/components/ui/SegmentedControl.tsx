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
