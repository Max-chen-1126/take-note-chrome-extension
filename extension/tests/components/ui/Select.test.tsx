import { render, screen, fireEvent } from "@testing-library/react";
import { Select } from "../../../entrypoints/sidepanel/components/ui/Select";

it("renders a placeholder option and calls onChange when an option is picked", () => {
  const onChange = vi.fn();
  render(
    <Select
      placeholder="選擇方法論"
      value=""
      onChange={onChange}
      options={[{ value: "m1", label: "方法論一" }]}
    />
  );
  const select = screen.getByDisplayValue("選擇方法論");
  fireEvent.change(select, { target: { value: "m1" } });
  expect(onChange).toHaveBeenCalledTimes(1);
});
