import { render, screen } from "@testing-library/react";
import { Badge } from "../../../entrypoints/sidepanel/components/ui/Badge";

it("renders children and applies the accent variant color", () => {
  render(<Badge variant="accent">YouTube</Badge>);
  const badge = screen.getByText("YouTube");
  expect(badge.style.color).toBe("var(--tn-accent)");
});

it("defaults to the neutral variant", () => {
  render(<Badge>文章</Badge>);
  const badge = screen.getByText("文章");
  expect(badge.style.color).toBe("var(--tn-text-muted)");
});
