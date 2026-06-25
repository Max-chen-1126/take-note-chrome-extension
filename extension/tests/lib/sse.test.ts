import { it, expect, vi } from "vitest";
import { parseSseChunk, streamNotes } from "../../entrypoints/sidepanel/lib/api";
import type { NoteRequest } from "../../entrypoints/sidepanel/lib/types";

const sampleReq: NoteRequest = {
  category: "article", methodology_id: "m", mode: "concise", direction: "",
  web_search: false, provider: "gemini",
  content: { title: "", url: "", text: "x", metadata: null },
};
it("parses complete events and keeps remainder", () => {
  const raw = 'event: step\ndata: {"step":"structure","status":"start","summary":null}\n\nevent: delta\ndata: {"text":"嗨"}\n\nevent: del';
  const { events, rest } = parseSseChunk(raw);
  expect(events.length).toBe(2);
  expect(events[0]).toEqual({ event:"step", data:{ step:"structure", status:"start", summary:null }});
  expect(events[1]).toEqual({ event:"delta", data:{ text:"嗨" }});
  expect(rest).toBe("event: del");
});

it("skips a malformed (non-JSON data) frame between two valid frames", () => {
  const raw =
    'event: step\ndata: {"step":"structure","status":"start","summary":null}\n\n' +
    "event: delta\ndata: {not valid json\n\n" +
    'event: delta\ndata: {"text":"嗨"}\n\n';
  const { events, rest } = parseSseChunk(raw);
  expect(events.length).toBe(2);
  expect(events[0]).toEqual({ event: "step", data: { step: "structure", status: "start", summary: null } });
  expect(events[1]).toEqual({ event: "delta", data: { text: "嗨" } });
  expect(rest).toBe("");
});

it("parses CRLF-delimited frames (\\r\\n\\r\\n)", () => {
  const raw =
    'event: step\r\ndata: {"step":"draft","status":"start","summary":null}\r\n\r\n' +
    'event: delta\r\ndata: {"text":"x"}\r\n\r\n';
  const { events, rest } = parseSseChunk(raw);
  expect(events.length).toBe(2);
  expect(events[0]).toEqual({ event: "step", data: { step: "draft", status: "start", summary: null } });
  expect(events[1]).toEqual({ event: "delta", data: { text: "x" } });
  expect(rest).toBe("");
});

it("forwards the AbortSignal to fetch", async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: false, status: 503, text: async () => "down", body: null,
  }));
  vi.stubGlobal("fetch", fetchMock);
  const gen = streamNotes("http://localhost:8080", null, sampleReq, controller.signal);
  await gen.next(); // triggers the fetch
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  vi.unstubAllGlobals();
});
