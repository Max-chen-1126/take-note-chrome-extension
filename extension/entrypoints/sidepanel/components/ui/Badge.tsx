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
