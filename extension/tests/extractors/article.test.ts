import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";
import { extractArticle } from "../../src/extractors/article";

function docFrom(file:string){ return new JSDOM(readFileSync(`tests/extractors/fixtures/${file}`,"utf8"),{url:"https://example.com"}).window.document; }

it("extracts the commandlinefanatic article body", () => {
  const r = extractArticle(docFrom("commandlinefanatic.html"), "https://commandlinefanatic.com/cgi-bin/showarticle.cgi?article=art008");
  expect(r.title.length).toBeGreaterThan(0);
  expect(r.text.length).toBeGreaterThan(500);          // 主要內文抽出
  expect(r.text).not.toMatch(/<script|<nav/i);          // 純文字、無標記
});

// TODO: capture rendered DOM fixture (SPA) — openai.com is behind a Cloudflare
// bot challenge; `curl` returns only the challenge shell (HTTP 403), not the
// article prose. Do not fabricate a fixture. Unskip once a real rendered-DOM
// fixture (e.g. saved via browser "Save complete webpage") is supplied.
it.skip("extracts the openai blog body (zh-Hant)", () => {
  const r = extractArticle(docFrom("openai-blog.html"), "https://openai.com/zh-Hant/index/building-self-improving-tax-agents-with-codex/");
  expect(r.text.length).toBeGreaterThan(300);
});
