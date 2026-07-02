import { render } from "@testing-library/react";
import { MarkdownView } from "../../entrypoints/sidepanel/components/MarkdownView";

it("renders markdown heading as h1", () => {
  const { container } = render(<MarkdownView markdown="# H" />);
  const h1 = container.querySelector("h1");
  expect(h1).toBeTruthy();
  expect(h1?.textContent).toBe("H");
});

it("sanitizes dangerous HTML from (untrusted-derived) notes", () => {
  const evil =
    "# Title\n\n" +
    '<img src=x onerror="alert(1)">\n\n' +
    "[click](javascript:alert(2))\n\n" +
    "<script>alert(3)</script>";
  const { container } = render(<MarkdownView markdown={evil} />);
  const html = container.innerHTML.toLowerCase();
  expect(html).not.toContain("onerror");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("javascript:");
  // legitimate content still renders
  expect(container.querySelector("h1")?.textContent).toBe("Title");
});

it("appends a blinking caret span when streaming is true", () => {
  const { container } = render(<MarkdownView markdown="Hello" streaming />);
  const caret = container.querySelector(".tn-stream-caret");
  expect(caret).toBeTruthy();
  expect(caret?.textContent).toBe("▍");
});

it("does not render the caret when streaming is false or omitted", () => {
  const { container } = render(<MarkdownView markdown="Hello" />);
  expect(container.querySelector(".tn-stream-caret")).toBeNull();
});
