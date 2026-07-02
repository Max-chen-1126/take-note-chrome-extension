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

it("renders a checkmark icon for done steps and a pulsing dot for the active step", () => {
  render(<StepProgress active="draft" doneSteps={["structure"]} />);

  const doneItem = screen.getByText("整理").closest("li")!;
  expect(doneItem.querySelector("svg")).toBeTruthy();
  expect(doneItem.querySelector(".tn-step-dot--active")).toBeNull();

  const activeItem = screen.getByText("草稿").closest("li")!;
  expect(activeItem.querySelector(".tn-step-dot--active")).toBeTruthy();
  expect(activeItem.querySelector("svg")).toBeNull();
});

it("shows the active step's description text", () => {
  render(<StepProgress active="verify" doneSteps={["structure", "draft"]} />);
  expect(screen.getByText("正在對照原始內容查核論述依據…")).toBeTruthy();
});

it("shows a non-breaking-space placeholder when no step is active", () => {
  render(<StepProgress active={null} doneSteps={[]} />);
  const status = screen.getByRole("status");
  expect(status.textContent).toBe(" ");
});
