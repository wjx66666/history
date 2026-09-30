import { expect, test } from "@playwright/test";

test("shows the broad date precision of the Maya sample", async ({ page }) => {
  await page.goto("/event/event_09bc7d3r");
  await expect(page.locator(".event-detail dd").first()).toContainText("约 公元 9 世纪");
  await expect(page.locator(".event-detail dd").first()).not.toContainText("801 年");
});

test("keeps timeline labels separate across desktop, tablet, and mobile", async ({ page }, testInfo) => {
  const response = await page.request.get("/api/timeline?period_id=period_global_sample");
  const dataset = await response.json() as { placements: Array<{ event: { event_id: string } }> };
  const eventCount = new Set(dataset.placements.map((item) => item.event.event_id)).size;
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?period=period_global_sample");
    await expect(page.getByRole("heading", { name: "全球历史首批真实样本" })).toBeVisible();
    await expect(page.getByLabel("当前范围概览").locator("strong").first()).toHaveText(String(eventCount));
    await expect(page.getByLabel("事件年份比例刻度").locator("i")).toHaveCount(eventCount);
    const measurements = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      lanes: [...document.querySelectorAll(".lane")].map((lane) => [...lane.querySelectorAll(".event-node")].map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      })),
    }));
    expect(measurements.scroll, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(measurements.viewport + 1);
    for (const nodes of measurements.lanes) for (let i = 0; i < nodes.length; i += 1) for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `overlap at ${width}px`).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`timeline-${width}.png`), fullPage: true });
  }
});

test("drills into proportional timeline and renders a real sampled event in two lanes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByText(/当前展示首批真实只读样本/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "全球历史首批真实样本" })).toBeVisible();

  const periodRow = page.getByLabel("下一层时间段");
  const childPeriod = page.getByRole("button", { name: /古典与先秦/ });
  const [rowBox, childBox] = await Promise.all([periodRow.boundingBox(), childPeriod.boundingBox()]);
  expect(rowBox).not.toBeNull();
  expect(childBox).not.toBeNull();
  expect(childBox!.x).toBeGreaterThanOrEqual(rowBox!.x);
  expect(childBox!.x + childBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);

  await childPeriod.click();
  await expect(page).toHaveURL(/period=period_ancient/);
  await expect(page.getByText("当前已是首批样本的最细预制层级")).toBeVisible();
  await expect(page.locator(".lane")).toHaveCount(7);

  const eventNodes = page.locator('[data-event-id="event_03np9s5j"]');
  await expect(eventNodes).toHaveCount(2);
  const hrefs = await eventNodes.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(new Set(hrefs).size).toBe(1);

  for (const lane of await page.locator(".lane").filter({ has: page.locator('[data-event-id="event_03np9s5j"]') }).all()) {
    const [labelBox, nodeBox] = await Promise.all([
      lane.locator(".lane-label").boundingBox(),
      lane.locator(".event-node").boundingBox(),
    ]);
    expect(labelBox).not.toBeNull();
    expect(nodeBox).not.toBeNull();
    expect(nodeBox!.x).toBeGreaterThanOrEqual(labelBox!.x + labelBox!.width);
  }

  await page.screenshot({ path: testInfo.outputPath("timeline-desktop.png"), fullPage: true });
});

test("filters, searches, and restores timeline state after event navigation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?period=period_ancient&regions=reg_mediterranean");

  await expect(page.locator(".lane")).toHaveCount(1);
  await expect(page.locator(".lane-label").getByText("地中海")).toBeVisible();

  await page.getByLabel("搜索事件或人物").fill("亚克兴");
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.locator(".search-results").getByText("亚克兴海战")).toBeVisible();

  await page.locator(".event-node").click();
  await expect(page).toHaveURL(/\/event\/event_03np9s5j/);
  await expect(page.getByRole("heading", { name: "亚克兴海战" })).toBeVisible();
  await expect(page.getByText("时间线位置").locator("..").getByText("4 条")).toBeVisible();

  await page.getByRole("link", { name: "返回时间线" }).click();
  await expect(page).toHaveURL(/period=period_ancient/);
  await expect(page).toHaveURL(/regions=reg_mediterranean/);
  await expect(page.locator(".lane")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("timeline-filtered-1024.png"), fullPage: true });
});

test("states that the first real-data sample is not global completion", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/全球批次仍在构建/)).toBeVisible();
  await expect(page.getByText("数据版本：P5 首批样本")).toBeVisible();
});

test("shows the explicit no-article and insufficient-source states", async ({ page }) => {
  await page.goto("/event/event_03np9s5j");

  await expect(page.getByText("暂无可用图片")).toBeVisible();
  await expect(page.getByRole("heading", { name: "尚无讲解" })).toBeVisible();
  await page.getByRole("button", { name: "生成讲解" }).click();
  await expect(page.getByRole("alert")).toContainText("没有足够的可核验来源");
  await expect(page.getByText("亚克兴海战讲解正文")).toHaveCount(0);
});

test("keeps a cached article visible when regeneration fails", async ({ page }, testInfo) => {
  const article = {
    event_id: "event_03np9s5j",
    content_zh: "这是一段仅用于浏览器验收的缓存讲解正文。",
    citations: [{ evidence_id: "evid_fixture", source_url: "https://example.test/source", publisher: "Fixture Source" }],
    uncertainty: "此内容是 Mock 验收材料，不构成历史事实。",
    link_refs: [],
    generated_at: "2026-09-30T00:00:00.000Z",
  };
  await page.route("**/api/articles/event_03np9s5j", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ article, cache: "hit" }) });
  });
  await page.route("**/api/articles/event_03np9s5j/generate", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "offline", message: "fixture offline" }) });
  });

  await page.goto("/event/event_03np9s5j");
  await expect(page.getByText(article.content_zh)).toBeVisible();
  await expect(page.getByRole("link", { name: "Fixture Source" })).toHaveAttribute("href", "https://example.test/source");
  await expect(page.getByText(article.uncertainty)).toBeVisible();
  await expect(page.locator(".related-links")).toHaveCount(0);

  await page.getByRole("button", { name: "重新生成" }).click();
  await expect(page.getByRole("alert")).toContainText("服务当前离线");
  await expect(page.getByText(article.content_zh)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("event-article-cache.png"), fullPage: true });
});

test("renders a cached image with source and license attribution", async ({ page }, testInfo) => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.route("**/api/media/event_03np9s5j", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "cached", images: [{ image_id: "image_fixture", event_id: "event_03np9s5j", source_url: "https://example.test/object", publisher: "Fixture Museum", author: "Fixture Author", license: "CC-BY-4.0", license_url: "https://creativecommons.org/licenses/by/4.0/", caption_zh: "Mock 验收图片", dimensions: { width: 1, height: 1 }, mime: "image/png" }] }) });
  });
  await page.route("**/api/media/event_03np9s5j/image_fixture/content", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: png });
  });

  await page.goto("/event/event_03np9s5j");
  const image = page.getByRole("img", { name: "Mock 验收图片" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await expect(page.getByText("Fixture Author · Fixture Museum")).toBeVisible();
  await expect(page.getByRole("link", { name: /原始页面/ })).toHaveAttribute("href", "https://example.test/object");
  await expect(page.getByRole("link", { name: /CC-BY-4.0/ })).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
  await page.screenshot({ path: testInfo.outputPath("event-cached-media.png"), fullPage: true });
});

test("keeps question answering ephemeral and routes revision intent to review", async ({ page }) => {
  await page.route("**/api/qa/event_03np9s5j", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ persistence: "none", answer: { answer_zh: "这是一次性的 Mock 回答。", citations: [{ evidence_id: "evid_fixture", source_url: "https://example.test/qa", publisher: "QA Fixture" }], revision_request: { event_id: "event_03np9s5j", prompt: "请修正日期" } } }) });
  });
  await page.goto("/event/event_03np9s5j");
  await page.getByRole("textbox", { name: "问题" }).fill("请修正日期");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByText("这是一次性的 Mock 回答。")).toBeVisible();
  await expect(page.getByText("已形成待审核修订请求，尚未修改时间线数据。")).toBeVisible();
  await expect(page.getByRole("link", { name: "QA Fixture" })).toHaveAttribute("href", "https://example.test/qa");

  await page.reload();
  await expect(page.getByText("这是一次性的 Mock 回答。")).toHaveCount(0);
  await expect(page.getByText("尚无讲解")).toBeVisible();
});
