import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsForm, type SettingsFormValue } from "../../entrypoints/sidepanel/components/SettingsForm";

const methodologies = [
  { id: "m1", name: "方法論一", categories: ["youtube"] },
  { id: "m2", name: "方法論二", categories: ["article"] },
];

const baseValue: SettingsFormValue = {
  methodology_id: "",
  mode: "concise",
  direction: "",
  web_search: false,
};

it("renders methodology options and calls onChange when one is selected", () => {
  const onChange = vi.fn();
  render(<SettingsForm methodologies={methodologies} value={baseValue} onChange={onChange} />);

  fireEvent.change(screen.getByDisplayValue("選擇方法論"), { target: { value: "m2" } });
  expect(onChange).toHaveBeenCalledWith({ ...baseValue, methodology_id: "m2" });
});

it("updates the direction text input", () => {
  const onChange = vi.fn();
  render(<SettingsForm methodologies={methodologies} value={baseValue} onChange={onChange} />);

  fireEvent.change(screen.getByPlaceholderText("例如：聚焦於實作細節"), {
    target: { value: "聚焦架構" },
  });
  expect(onChange).toHaveBeenCalledWith({ ...baseValue, direction: "聚焦架構" });
});

it("switches mode via the segmented control", () => {
  const onChange = vi.fn();
  render(<SettingsForm methodologies={methodologies} value={baseValue} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "詳細" }));
  expect(onChange).toHaveBeenCalledWith({ ...baseValue, mode: "detailed" });
});

it("renders the web-search toggle as a real switch button and toggles on click", () => {
  const onChange = vi.fn();
  render(<SettingsForm methodologies={methodologies} value={baseValue} onChange={onChange} />);

  const toggle = screen.getByRole("switch", { name: "查證上網" });
  expect(toggle.tagName).toBe("BUTTON");
  expect(toggle).toHaveAttribute("aria-checked", "false");

  fireEvent.click(toggle);
  expect(onChange).toHaveBeenCalledWith({ ...baseValue, web_search: true });
});
