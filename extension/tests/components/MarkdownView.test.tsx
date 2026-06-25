import { render } from "@testing-library/react";
import { MarkdownView } from "../../entrypoints/sidepanel/components/MarkdownView";

it("renders markdown heading as h1", () => {
  const { container } = render(<MarkdownView markdown="# H" />);
  const h1 = container.querySelector("h1");
  expect(h1).toBeTruthy();
  expect(h1?.textContent).toBe("H");
});
