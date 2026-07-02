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
