import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CopyButton } from "../../entrypoints/sidepanel/components/CopyButton";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

it("keeps the live region outside the button and announces via its text content", async () => {
  render(<CopyButton text="note content" />);

  const button = screen.getByRole("button", { name: "複製" });
  const liveRegion = screen.getByRole("status");
  expect(liveRegion.textContent).toBe("");
  expect(button.contains(liveRegion)).toBe(false);

  fireEvent.click(button);

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "已複製" })).toBeTruthy();
  });
  expect(screen.getByRole("status").textContent).toBe("已複製內容");
});
