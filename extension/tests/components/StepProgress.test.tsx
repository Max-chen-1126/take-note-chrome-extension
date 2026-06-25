import { render, screen } from "@testing-library/react";
import { StepProgress } from "../../entrypoints/sidepanel/components/StepProgress";

it("renders 5 step labels and marks active", () => {
  render(<StepProgress active="draft" doneSteps={["structure"]} />);
  ["整理", "草稿", "補充", "查證", "成稿"].forEach((l) =>
    expect(screen.getByText(l)).toBeTruthy()
  );
  const active = screen.getByText("草稿");
  expect(active.closest("[data-state]")).toHaveAttribute("data-state", "active");
  const done = screen.getByText("整理");
  expect(done.closest("[data-state]")).toHaveAttribute("data-state", "done");
  const pending = screen.getByText("補充");
  expect(pending.closest("[data-state]")).toHaveAttribute("data-state", "pending");
});
