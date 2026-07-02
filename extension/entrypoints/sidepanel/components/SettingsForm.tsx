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
