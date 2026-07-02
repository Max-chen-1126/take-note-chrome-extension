import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "../../../entrypoints/sidepanel/components/ui/Toggle";

it("renders as a real button with role=switch and toggles on click", () => {
  const onChange = vi.fn();
  render(<Toggle ariaLabel="查證上網" checked={false} onChange={onChange} />);

  const toggle = screen.getByRole("switch", { name: "查證上網" });
  expect(toggle.tagName).toBe("BUTTON");
  expect(toggle).toHaveAttribute("aria-checked", "false");

  fireEvent.click(toggle);
  expect(onChange).toHaveBeenCalledWith(true);
});
