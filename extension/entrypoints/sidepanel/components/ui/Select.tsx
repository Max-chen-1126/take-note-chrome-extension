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
