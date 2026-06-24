import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("tokens file exists with primary color", async () => {
    const css = await import("fs").then((m) =>
      m.readFileSync("entrypoints/sidepanel/styles/tokens.css", "utf8")
    );
    expect(css).toContain("--tn-primary");
  });
});
