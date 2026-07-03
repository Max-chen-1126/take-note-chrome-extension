import { render } from "@testing-library/react";
import { ExtractCardSkeleton } from "../../entrypoints/sidepanel/components/ExtractCardSkeleton";

it("renders skeleton placeholder bars without crashing", () => {
  const { container } = render(<ExtractCardSkeleton />);
  const bars = container.querySelectorAll(".tn-skeleton");
  expect(bars.length).toBeGreaterThanOrEqual(6);
});
