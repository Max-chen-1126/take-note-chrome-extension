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
