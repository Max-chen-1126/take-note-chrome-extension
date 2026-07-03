import { render, screen } from "@testing-library/react";
import { Card } from "../../../entrypoints/sidepanel/components/ui/Card";

it("renders as a div by default and forwards extra attributes like role", () => {
  render(<Card role="alert">內容</Card>);
  expect(screen.getByRole("alert")).toHaveTextContent("內容");
});

it("renders as the element passed via `as`", () => {
  const { container } = render(<Card as="section">內容</Card>);
  expect(container.querySelector("section")).toBeTruthy();
});
