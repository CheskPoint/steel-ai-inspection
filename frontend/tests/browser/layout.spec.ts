import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.request.post("http://localhost:8001/api/v1/auth/login", {
    headers: { Origin: "http://localhost:3001" }, data: { username: "admin", password: "admin123" },
  });
});

test("production navigation and merged detection modes stay accessible", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("button").first()).toHaveAccessibleName("检测工作台");
  await expect(nav.getByRole("button").nth(1)).toHaveAccessibleName("生产");
  await nav.getByRole("button", { name: "生产", exact: true }).click();
  await page.getByRole("tab", { name: "钢板管理" }).click();
  await expect(page.getByRole("button", { name: "＋ 登记钢板" })).toBeVisible();
  await page.getByRole("tab", { name: "生产批次" }).click();
  await expect(page.getByRole("button", { name: "＋ 新建批次" })).toBeVisible();
  await nav.getByRole("button", { name: "质量分析与报告" }).click();
  await page.getByRole("tab", { name: "质检报告" }).click();
  await expect(page.getByRole("button", { name: "＋ 生成报告" })).toBeVisible();
  await nav.getByRole("button", { name: "检测工作台" }).click();
  await expect(page.getByRole("tab").first()).toHaveText("实时监测");
  await expect(page.getByRole("tab", { name: "实时监测" })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: "../outputs/layout-monitor.png", fullPage: true });
  await page.getByRole("tab", { name: "图片/批量检测" }).click();
  await expect(page.getByLabel("选择图片", { exact: true })).toHaveAttribute("multiple", "");
  await expect(page.getByLabel("选择图片文件夹")).toHaveCount(1);
  await page.screenshot({ path: "../outputs/layout-bulk.png", fullPage: true });
});

test("completed queue and date folders retain global search and Beijing date boundaries", async ({ page }) => {
  // UI fixture covers grouping/status presentation; backend tests exercise the real automatic completion policy.
  const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#a5b5b8"/></svg>');
  const base = { source: "batch", coil_id: null, model: "best.pt", threshold: .25, count: 1,
    detections: [{ class_id: 0, class_name: "inclusion", confidence: .99, bbox: [10, 10, 70, 80] }],
    model_classes: ["inclusion", "dents", "oil_spots", "pits", "punching", "linear", "macular"],
    image_width: 160, image_height: 120, review_note: "", reviewed_detections: null,
    original_image_url: image, annotated_image_url: image };
  const records = [
    { ...base, id: "auto-ui", filename: "high-confidence.png", review_status: "auto_confirmed", created_at: "2026-10-20T16:01:00Z" },
    { ...base, id: "human-ui", filename: "human-reviewed.png", review_status: "confirmed", created_at: "2026-10-20T16:02:00Z" },
    { ...base, id: "pending-ui", filename: "needs-review.png", review_status: "pending", created_at: "2026-10-20T15:59:00Z" },
  ];
  // Mock the paginated read contract; backend query tests cover filter implementation.
  const beijingDate = (value: string) => new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.route(/\/api\/v1\/(inspections|inspection-folders)\?/, async route => {
    const url = new URL(route.request().url());
    const params = url.searchParams;
    const status = params.get("status");
    const query = params.get("query")?.toLowerCase() || "";
    const rows = records.filter(row => {
      if (status === "completed" && row.review_status === "pending") return false;
      if (status === "human_reviewed" && !["confirmed", "corrected", "false_positive"].includes(row.review_status)) return false;
      if (status && !["completed", "human_reviewed"].includes(status) && row.review_status !== status) return false;
      if (query && !`${row.filename} ${row.id}`.toLowerCase().includes(query)) return false;
      if (params.get("folder") && beijingDate(row.created_at) !== params.get("folder")) return false;
      return true;
    });
    const offset = Number(params.get("offset") || 0);
    const limit = Number(params.get("limit") || 36);
    if (url.pathname.endsWith("/inspection-folders")) {
      const dates = [...new Set(rows.map(row => beijingDate(row.created_at)))].sort().reverse();
      const items = dates.map(date => ({ date, total: rows.filter(row => beijingDate(row.created_at) === date).length,
        pending: rows.filter(row => beijingDate(row.created_at) === date && row.review_status === "pending").length }));
      await route.fulfill({ json: { items: items.slice(offset, offset + limit), total: items.length } });
    } else {
      await route.fulfill({ json: { items: rows.slice(offset, offset + limit), total: rows.length } });
    }
  });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "缺陷复核" }).click();
  await expect(page.locator(".sv-image-card")).toHaveCount(1);
  await expect(page.locator(".sv-image-card")).toContainText("needs-review.png");
  await expect(page.getByRole("tab", { name: "待人工复核", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "AI 自动确认 · 抽检", exact: true }).click();
  await expect(page.locator(".sv-image-card")).toHaveCount(1);
  await expect(page.locator(".sv-image-card")).toContainText("high-confidence.png");
  await expect(page.locator(".sv-image-card")).toContainText("AI 自动确认");
  await page.getByRole("tab", { name: "人工已复核", exact: true }).click();
  await expect(page.locator(".sv-image-card")).toHaveCount(1);
  await expect(page.locator(".sv-image-card")).toContainText("human-reviewed.png");
  await expect(page.locator(".sv-image-card")).toContainText("人工已确认");
  await page.getByRole("tab", { name: "全部已完成", exact: true }).click();
  await expect(page.locator(".sv-image-card")).toHaveCount(2);
  await page.getByRole("navigation").getByRole("button", { name: "质量追溯" }).click();
  await expect(page.locator(".sv-folder-card")).toHaveCount(2);
  await page.screenshot({ path: "../outputs/layout-date-folders.png", fullPage: true });
  await page.getByRole("button", { name: "打开 2026-10-21 文件夹" }).click();
  await expect(page.locator(".sv-image-card")).toHaveCount(2);
  await expect(page.locator(".sv-image-card").filter({ hasText: "high-confidence.png" })).toBeVisible();
  await page.getByLabel("搜索图片或记录编号").fill("needs-review");
  await expect(page.locator(".sv-folder-card")).toHaveCount(1);
  await page.getByRole("button", { name: "打开 2026-10-20 文件夹" }).click();
  await expect(page.locator(".sv-image-card")).toContainText("needs-review.png");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: "../outputs/layout-folder-mobile.png", fullPage: true });
});
