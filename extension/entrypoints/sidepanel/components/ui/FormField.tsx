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
