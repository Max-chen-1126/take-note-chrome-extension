import { render, screen } from "@testing-library/react";
import { ExtractCard } from "../../entrypoints/sidepanel/components/ExtractCard";
import type { ExtractResult } from "../../entrypoints/sidepanel/lib/types";

const result: ExtractResult = {
  ok: true,
  category: "article",
  content: {
    title: "測試文章標題",
    url: "https://example.com/a",
    text: "這是擷取的內文預覽文字。",
    metadata: null,
  },
  error: null,
};

it("shows title and char count for the extract result", () => {
  render(<ExtractCard result={result} />);
  expect(screen.getByText("測試文章標題")).toBeTruthy();
  expect(
    screen.getByText((text) => text.includes(String(result.content.text.length)))
  ).toBeTruthy();
  expect(screen.getByText("這是擷取的內文預覽文字。")).toBeTruthy();
});
