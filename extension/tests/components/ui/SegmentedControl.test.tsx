import { render, screen, fireEvent } from "@testing-library/react";
import { SegmentedControl } from "../../../entrypoints/sidepanel/components/ui/SegmentedControl";

it("marks the active option as pressed and calls onChange on click", () => {
  const onChange = vi.fn();
  render(
    <SegmentedControl
      ariaLabel="模式"
      value="concise"
      onChange={onChange}
      options={[
        { value: "concise", label: "精簡" },
        { value: "detailed", label: "詳細" },
      ]}
    />
  );
  expect(screen.getByRole("button", { name: "精簡" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "詳細" })).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(screen.getByRole("button", { name: "詳細" }));
  expect(onChange).toHaveBeenCalledWith("detailed");
});
