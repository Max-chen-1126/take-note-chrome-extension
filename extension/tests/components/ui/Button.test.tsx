import { render, screen, fireEvent } from "@testing-library/react";
import { RotateCcw } from "lucide-react";
import { Button } from "../../../entrypoints/sidepanel/components/ui/Button";

it("renders children as the accessible name and handles clicks", () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>重試</Button>);
  const button = screen.getByRole("button", { name: "重試" });
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("renders an icon as aria-hidden so it never joins the accessible name", () => {
  render(
    <Button icon={RotateCcw} onClick={() => {}}>
      重試
    </Button>
  );
  const button = screen.getByRole("button", { name: "重試" });
  const icon = button.querySelector("svg");
  expect(icon).toHaveAttribute("aria-hidden", "true");
});
