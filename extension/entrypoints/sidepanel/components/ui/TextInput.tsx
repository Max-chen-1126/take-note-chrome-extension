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
