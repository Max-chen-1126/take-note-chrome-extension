import { it, expect } from "vitest";
import { parseSseChunk } from "../../entrypoints/sidepanel/lib/api";
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
