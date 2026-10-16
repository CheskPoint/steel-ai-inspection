import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the SteelVision application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /SteelVision \| 热轧钢带划痕检测与质量追溯/);
  assert.match(html, /面向热轧钢表面缺陷检测、人工复核与质量追溯/);
  assert.match(html, /热轧钢表面质量总览/);
  assert.match(html, /模型未部署/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("keeps the true-empty-state quality business framework in the client", async () => {
  const [page, login, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /生产批次/);
  assert.match(page, /人工复核/);
  assert.match(page, /模型未部署/);
  assert.match(page, /不展示虚构检测结果/);
  assert.match(page, /质量追溯/);
  assert.match(login, /admin123/);
  assert.match(css, /\.industrial-empty/);
  assert.match(css, /\.inspection-workbench/);
});
