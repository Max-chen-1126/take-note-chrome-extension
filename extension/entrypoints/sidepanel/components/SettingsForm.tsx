import type { Mode } from "../lib/types";

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
  fontSize: 12,
  color: "var(--tn-muted)",
  fontWeight: 600,
};

const controlStyle = {
  fontFamily: "var(--tn-font)",
  fontSize: 14,
  color: "var(--tn-text)",
  background: "var(--tn-bg)",
  border: "1px solid var(--tn-border)",
  borderRadius: "var(--tn-r-control)",
  padding: "8px 12px",
  width: "100%",
  boxSizing: "border-box" as const,
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
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={labelStyle}>方法論</span>
        <select
          style={controlStyle}
          value={value.methodology_id}
          onChange={(e) => update({ methodology_id: e.target.value })}
        >
          <option value="" disabled>
            選擇方法論
          </option>
          {methodologies.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={labelStyle}>模式</span>
        <div
          role="group"
          aria-label="模式"
          style={{
            display: "inline-flex",
            border: "1px solid var(--tn-border)",
            borderRadius: "var(--tn-r-pill)",
            padding: 4,
            gap: 4,
            width: "fit-content",
          }}
        >
          {MODE_OPTIONS.map((opt) => {
            const active = value.mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => update({ mode: opt.value })}
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
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={labelStyle}>方向</span>
        <input
          type="text"
          style={controlStyle}
          value={value.direction}
          placeholder="例如：聚焦於實作細節"
          onChange={(e) => update({ direction: e.target.value })}
        />
      </label>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span style={labelStyle}>查證上網</span>
        <span
          role="switch"
          aria-checked={value.web_search}
          tabIndex={0}
          onClick={() => update({ web_search: !value.web_search })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              update({ web_search: !value.web_search });
            }
          }}
          style={{
            width: 40,
            height: 24,
            borderRadius: "var(--tn-r-pill)",
            background: value.web_search ? "var(--tn-primary)" : "var(--tn-border)",
            position: "relative",
            cursor: "pointer",
            flexShrink: 0,
            display: "inline-block",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: value.web_search ? 18 : 2,
              width: 20,
              height: 20,
              borderRadius: "var(--tn-r-pill)",
              background: "var(--tn-on-primary)",
              transition: "left 0.15s ease",
            }}
          />
        </span>
      </label>
    </form>
  );
}
