import { render, screen } from "@testing-library/react";
import { FormField } from "../../../entrypoints/sidepanel/components/ui/FormField";

it("associates the label with its control via native label wrapping", () => {
  render(
    <FormField label="方向">
      <input aria-label="方向" defaultValue="" />
    </FormField>
  );
  expect(screen.getByText("方向")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "方向" })).toBeTruthy();
});
