import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { App, type AppDeps } from "../../entrypoints/sidepanel/App";
import type { ExtractResult, SseEvent } from "../../entrypoints/sidepanel/lib/types";

const extractResult: ExtractResult = {
  ok: true,
  category: "youtube",
  content: {
    title: "測試影片標題",
    url: "https://www.youtube.com/watch?v=abc123",
    text: "這是擷取的逐字稿內容預覽。",
    metadata: { author: "頻道名稱" },
  },
  error: null,
};

const methodologies = [
  { id: "m1", name: "方法論一", categories: ["youtube", "article"] },
];

async function* happyPathEvents(): AsyncGenerator<SseEvent> {
  yield { event: "step", data: { step: "structure", status: "start", summary: null } };
  yield { event: "step", data: { step: "structure", status: "done", summary: null } };
  yield { event: "step", data: { step: "draft", status: "start", summary: null } };
  yield { event: "step", data: { step: "draft", status: "done", summary: null } };
  yield { event: "step", data: { step: "augment", status: "start", summary: null } };
  yield { event: "step", data: { step: "augment", status: "done", summary: null } };
  yield { event: "step", data: { step: "verify", status: "start", summary: null } };
  yield { event: "step", data: { step: "verify", status: "done", summary: null } };
  yield { event: "step", data: { step: "format", status: "start", summary: null } };
  yield { event: "delta", data: { text: "# 筆記標題\n\n" } };
  yield { event: "delta", data: { text: "這是內容第一段。" } };
  yield { event: "step", data: { step: "format", status: "done", summary: null } };
  yield { event: "done", data: { markdown: "# 筆記標題\n\n這是內容第一段。" } };
}

async function* errorMidStreamEvents(): AsyncGenerator<SseEvent> {
  yield { event: "step", data: { step: "structure", status: "start", summary: null } };
  yield { event: "step", data: { step: "structure", status: "done", summary: null } };
  yield { event: "delta", data: { text: "已經串到一半的內容。" } };
  yield { event: "error", data: { code: "upstream_failed", message: "上游服務錯誤" } };
}

function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    loadMethodologies: vi.fn().mockResolvedValue(methodologies),
    extract: vi.fn().mockResolvedValue(extractResult),
    process: vi.fn(() => happyPathEvents()),
    ...overrides,
  };
}

it("reaches ready state after mount with extract card and settings", async () => {
  const deps = makeDeps();
  render(<App deps={deps} />);

  expect(await screen.findByText("測試影片標題")).toBeTruthy();
  expect(deps.extract).toHaveBeenCalledTimes(1);
  expect(deps.loadMethodologies).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: /開始/ })).toBeTruthy();
});

it("transitions to result page on 開始, streams steps, and finishes with markdown + copy", async () => {
  const deps = makeDeps();
  render(<App deps={deps} />);

  await screen.findByText("測試影片標題");
  fireEvent.click(screen.getByRole("button", { name: /開始/ }));

  expect(deps.process).toHaveBeenCalledTimes(1);

  // Result page: step progress should eventually show "format" as done/active.
  await waitFor(() => {
    const formatLabel = screen.getByText("成稿");
    expect(formatLabel.closest("[data-state]")).toHaveAttribute("data-state", "done");
  });

  // Final markdown content rendered.
  await waitFor(() => {
    expect(screen.getByText("這是內容第一段。")).toBeTruthy();
  });

  // Copy button is now available.
  expect(screen.getByRole("button", { name: /複製/ })).toBeTruthy();

  // Back button returns to setup page.
  fireEvent.click(screen.getByRole("button", { name: /返回/ }));
  expect(await screen.findByText("測試影片標題")).toBeTruthy();
});

it("shows extract_error when extract fails and does not render settings", async () => {
  const deps = makeDeps({
    extract: vi.fn().mockResolvedValue({
      ok: false,
      category: "article",
      content: { title: "", url: "https://example.com", text: "", metadata: null },
      error: { code: "extract_failed", message: "無法讀取字幕，請開啟字幕面板後重試。" },
    }),
  });
  render(<App deps={deps} />);

  expect(await screen.findByText(/無法讀取字幕/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /開始/ })).toBeNull();
});

it("shows stream_error mid-stream while preserving already-streamed content", async () => {
  const deps = makeDeps({ process: vi.fn(() => errorMidStreamEvents()) });
  render(<App deps={deps} />);

  await screen.findByText("測試影片標題");
  fireEvent.click(screen.getByRole("button", { name: /開始/ }));

  expect(await screen.findByText(/上游服務錯誤/)).toBeTruthy();
  // Already-streamed delta content remains visible.
  expect(screen.getByText("已經串到一半的內容。")).toBeTruthy();
});

it("retries extraction from extract_error via the retry button", async () => {
  const failResult = {
    ok: false,
    category: "article" as const,
    content: { title: "", url: "https://example.com", text: "", metadata: null },
    error: { code: "extract_failed", message: "無法讀取字幕，請開啟字幕面板後重試。" },
  };
  const extract = vi.fn().mockResolvedValueOnce(failResult).mockResolvedValueOnce(extractResult);
  const deps = makeDeps({ extract });
  render(<App deps={deps} />);

  expect(await screen.findByText(/無法讀取字幕/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /重試/ }));

  expect(await screen.findByText("測試影片標題")).toBeTruthy();
  expect(extract).toHaveBeenCalledTimes(2);
});

it("retries the stream from stream_error via the retry button", async () => {
  const process = vi
    .fn()
    .mockImplementationOnce(() => errorMidStreamEvents())
    .mockImplementationOnce(() => happyPathEvents());
  const deps = makeDeps({ process });
  render(<App deps={deps} />);

  await screen.findByText("測試影片標題");
  fireEvent.click(screen.getByRole("button", { name: /開始/ }));

  expect(await screen.findByText(/上游服務錯誤/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /重試/ }));

  await waitFor(() => {
    expect(screen.getByText("這是內容第一段。")).toBeTruthy();
  });
  expect(process).toHaveBeenCalledTimes(2);
});
