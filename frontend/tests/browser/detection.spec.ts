import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

async function removeFixture(folder: string) {
  const target = resolve(folder);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("steelvision-")) throw new Error("Unexpected fixture path");
  await rm(target, { recursive: true, force: true });
}

async function image(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#888"; context.fillRect(0, 0, 64, 64);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return Buffer.from(data, "base64");
}

test.beforeEach(async ({ page }) => {
  // Real cookie authentication against the isolated browser-test backend.
  const login=await page.request.post("http://localhost:8001/api/v1/auth/login", {data:{username:"admin",password:"admin123"},headers:{Origin:"http://localhost:3001"}});
  expect(login.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "模型已加载" })).toBeVisible();
});

test("reads real model metadata and reports unavailable backend", async ({ page }) => {
  await page.getByRole("button", { name: /模型信息/ }).click();
  await expect(page.getByRole("heading", {name:"best.pt"})).toBeVisible();
  await expect(page.locator(".sv-class-tags").getByText("macular", {exact:true})).toBeVisible();
  await page.route("**/api/v1/system/info", route => route.abort());
  await page.getByRole("button", { name: "重新检查" }).click();
  await expect(page.getByRole("button", { name: "后端未连接" })).toBeVisible();
  await page.unroute("**/api/v1/system/info");
  await page.getByRole("button", { name: "重新检查" }).click();
  await expect(page.getByRole("button", { name: "模型已加载" })).toBeVisible();
});

test("single image still invokes best.pt and shows a real result", async ({ page }) => {
  await page.getByRole("button", { name: /检测工作台/ }).click();
  await page.getByRole("tab", {name:"图片/批量检测"}).click();
  await page.getByLabel("选择图片", {exact:true}).setInputFiles({ name: "single.png", mimeType: "image/png", buffer: await image(page) });
  await page.getByRole("button", { name: "开始图片检测", exact: true }).click();
  await expect(page.getByAltText("模型标注结果")).toBeVisible();
  await expect(page.getByRole("region", { name: "检测结果" })).toContainText("best.pt");
});

test("folder includes nested images, continues after corruption and exports details", async ({ page }) => {
  const folder = await mkdtemp(join(tmpdir(), "steelvision-batch-"));
  try {
    await mkdir(join(folder, "nested"));
    const png = await image(page);
    await writeFile(join(folder, "a.png"), png);
    await writeFile(join(folder, "b-broken.jpg"), "invalid image");
    await writeFile(join(folder, "nested", "c.png"), png);
    await writeFile(join(folder, "notes.txt"), "ignored");
    await page.getByRole("button", { name: /检测工作台/ }).click();
    await page.getByRole("tab", { name: "图片/批量检测" }).click();
    await page.getByLabel("选择图片文件夹").setInputFiles(folder);
    await page.getByRole("button", { name: "开始图片检测" }).click();
    await expect(page.getByRole("status")).toContainText("完成 3 / 3 · 成功 2 · 失败 1 · 已跳过 1");
    await expect(page.getByAltText("模型标注结果")).toBeVisible();
    await page.locator(".cam-thumbnail").filter({ hasText: "b-broken.jpg" }).click();
    await expect(page.locator(".warning")).toContainText("图片无法解码");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 CSV 明细" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let csv = "";
    for await (const chunk of stream!) csv += chunk.toString("utf8");
    expect(csv).toContain("nested/c.png");
    expect(csv).toContain("图片无法解码");
    expect(csv).toContain("成功");
  } finally { await removeFixture(folder); }
});

test("batch stop keeps current result and supports continuing pending images", async ({ page }) => {
  const folder = await mkdtemp(join(tmpdir(), "steelvision-stop-"));
  let release: () => void = () => {};
  try {
    const png = await image(page);
    for (const name of ["a.png", "b.png", "c.png"]) await writeFile(join(folder, name), png);
    let notify: () => void = () => {};
    const entered = new Promise<void>(resolve => { notify = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route("**/api/v1/inferences", async route => {
      requests++;
      if (requests === 1) { notify(); await gate; }
      await route.continue();
    });
    await page.getByRole("button", { name: /检测工作台/ }).click();
    await page.getByRole("tab", { name: "图片/批量检测" }).click();
    await page.getByLabel("选择图片文件夹").setInputFiles(folder);
    await page.getByRole("button", { name: "开始图片检测" }).click();
    await entered;
    await page.getByRole("button", { name: "停止后续任务" }).click();
    release();
    await expect(page.getByRole("button", { name: "继续图片检测" })).toBeEnabled();
    expect(requests).toBe(1);
    await expect(page.getByRole("status")).toContainText("完成 1 / 3");
    await page.getByRole("button", { name: "继续图片检测" }).click();
    await expect(page.getByRole("status")).toContainText("完成 3 / 3 · 成功 3");
  } finally { release(); await removeFixture(folder); }
});

test("synthetic camera continuously infers, stops, and releases tracks on navigation", async ({ page }) => {
  // Native canvas MediaStream avoids depending on the host's camera device service.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext("2d")!;
      const draw = () => { context.fillStyle = "#888"; context.fillRect(0, 0, 640, 480); context.fillStyle = "#333"; context.fillRect(Date.now() % 500, 200, 40, 40); };
      draw();
      const timer = setInterval(draw, 100);
      const stream = canvas.captureStream(10);
      const track = stream.getTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      return stream;
    };
  });
  let requests = 0;
  page.on("request", request => { if (request.url().endsWith("/inferences")) requests++; });
  await page.getByRole("button", { name: /检测工作台/ }).click();
  await page.getByRole("tab", { name: "实时监测" }).click();
  await page.getByRole("button", { name: "发现 / 刷新摄像头", exact: true }).click();
  await page.getByRole("button", { name: "打开摄像头", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始连续检测" })).toBeEnabled();
  await page.getByRole("button", { name: "开始连续检测" }).click();
  await expect.poll(() => requests).toBeGreaterThanOrEqual(3);
  await expect(page.getByAltText("模型标注结果")).toBeVisible();
  await page.getByRole("button", { name: "停止检测", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始连续检测" })).toBeEnabled();
  const stoppedAt = requests;
  await page.waitForTimeout(1200);
  expect(requests).toBe(stoppedAt);
  const track = await page.locator("video").evaluateHandle(element => ((element as HTMLVideoElement).srcObject as MediaStream).getTracks()[0]);
  await page.getByRole("button", { name: /质检总览/ }).click();
  expect(await track.evaluate(value => value.readyState)).toBe("ended");
});

test("permission rejection remains recoverable", async ({ page }) => {
  await page.getByRole("button", { name: /检测工作台/ }).click();
  await page.getByRole("tab", { name: "实时监测" }).click();
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("denied", "NotAllowedError"); }; });
  await page.getByRole("button", { name: "发现 / 刷新摄像头", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText("摄像头权限被拒绝");
  await expect(page.getByRole("button", { name: "发现 / 刷新摄像头", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "开始连续检测" })).toBeDisabled();
});
