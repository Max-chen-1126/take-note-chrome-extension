import { describe, it, expect } from "vitest";
import { STEP_LABELS, type NoteRequest } from "../../entrypoints/sidepanel/lib/types";
it("step labels cover the 5 backend steps", () => {
  expect(Object.keys(STEP_LABELS)).toEqual(["structure","draft","augment","verify","format"]);
});
it("NoteRequest shape compiles", () => {
  const r: NoteRequest = { category:"youtube", methodology_id:"m", mode:"concise",
    direction:"", web_search:false, provider:"gemini",
    content:{ title:"", url:"", text:"x", metadata:null } };
  expect(r.provider).toBe("gemini");
});
