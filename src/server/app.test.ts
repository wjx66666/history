import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { TimelineDataset } from "../shared/timeline.js";
import { rebuildIndex } from "../builder/sqlite-index.js";
import { createApp } from "./app.js";
import { ArticleCache } from "./article-cache.js";
import { ArticleGenerationService, GenerationError, type ModelProvider } from "./model-adapter.js";

let app: FastifyInstance | undefined;
let temporaryDirectory: string;
let articleProvider: ReturnType<typeof vi.fn<ModelProvider["generateArticle"]>>;
const fixture = JSON.parse(readFileSync(new URL("../../data/fixtures/p3-3-dataset.json", import.meta.url), "utf8")) as TimelineDataset;

beforeEach(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "timeline-api-"));
  const indexPath = join(temporaryDirectory, "timeline.sqlite");
  rebuildIndex(fixture, indexPath);
  articleProvider = vi.fn<ModelProvider["generateArticle"]>(async () => ({ content_zh: "契约讲解正文", citation_ids: ["evid_fixture"], uncertainty: null }));
  const articleCache = new ArticleCache({
    directory: join(temporaryDirectory, "articles"),
    generationService: new ArticleGenerationService({ generateArticle: (...args) => articleProvider(...args) }, { timeoutMs: 100, maxRetries: 0 }),
    evidenceLoader: async (eventId, titleZh) => ({ event_id: eventId, title_zh: titleZh, evidence: [{ evidence_id: "evid_fixture", source_url: "https://example.test/source", publisher: "Fixture", retrieved_at: "2026-09-30T00:00:00Z", claim_text: "fixture" }] }),
    modelProfile: { provider: "fixture", model: "fixture-v1" },
  });
  app = await createApp({ indexPath, articleCache });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("local service", () => {
  it("reports its health without exposing configuration", async () => {
    const response = await app!.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: "global-history-timeline", status: "ok" });
  });

  it("returns root periods and all region lines", async () => {
    const response = await app!.inject({ method: "GET", url: "/api/timeline" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: "built", placements: [] });
    expect(response.json().periods).toHaveLength(3);
    expect(response.json().regions).toHaveLength(2);
  });

  it("returns a built period with shared placements and filters by region", async () => {
    const all = await app!.inject({ method: "GET", url: "/api/timeline?period_id=period_fixture_child" });
    expect(all.statusCode).toBe(200);
    expect(all.json().placements).toHaveLength(2);
    expect(new Set(all.json().placements.map((item: { event: { event_id: string } }) => item.event.event_id))).toEqual(new Set(["event_fixture_shared"]));

    const filtered = await app!.inject({ method: "GET", url: "/api/timeline?period_id=period_fixture_child&regions=reg_fixture_west" });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().placements).toHaveLength(1);
    expect(filtered.json().placements[0].region.region_id).toBe("reg_fixture_west");
  });

  it("returns period children and maps an event to both placements", async () => {
    const period = await app!.inject({ method: "GET", url: "/api/periods/period_fixture_root" });
    expect(period.statusCode).toBe(200);
    expect(period.json().children.map((item: { period_id: string }) => item.period_id)).toEqual(["period_fixture_child"]);

    const event = await app!.inject({ method: "GET", url: "/api/events/event_fixture_shared" });
    expect(event.statusCode).toBe(200);
    expect(event.json().placements).toHaveLength(2);
    expect(event.json().placements.map((item: { display_weight: string }) => item.display_weight)).toEqual(["primary", "secondary"]);
  });

  it("distinguishes checked-empty, unbuilt, missing period, and missing region", async () => {
    const empty = await app!.inject({ method: "GET", url: "/api/timeline?period_id=period_fixture_checked_empty" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ state: "checked_empty", placements: [] });

    const unbuilt = await app!.inject({ method: "GET", url: "/api/timeline?period_id=period_fixture_unbuilt" });
    expect(unbuilt.statusCode).toBe(409);
    expect(unbuilt.json().code).toBe("unbuilt");

    const missing = await app!.inject({ method: "GET", url: "/api/timeline?period_id=period_missing" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("period_not_found");

    const region = await app!.inject({ method: "GET", url: "/api/timeline?regions=reg_missing" });
    expect(region.statusCode).toBe(404);
    expect(region.json().code).toBe("region_not_found");
  });

  it("returns event results for Chinese event and person-related searches", async () => {
    const eventSearch = await app!.inject({ method: "GET", url: "/api/search?q=%E8%B7%A8%E7%BA%BF%E5%85%B1%E4%BA%AB" });
    expect(eventSearch.statusCode).toBe(200);
    expect(eventSearch.json()).toMatchObject({ result_type: "event" });
    expect(eventSearch.json().events[0].event_id).toBe("event_fixture_shared");

    const personSearch = await app!.inject({ method: "GET", url: "/api/search?q=%E4%BA%BA%E7%89%A9%E7%9B%B8%E5%85%B3" });
    expect(personSearch.statusCode).toBe(200);
    expect(personSearch.json().events[0].event_id).toBe("event_fixture_shared");

    const noResults = await app!.inject({ method: "GET", url: "/api/search?q=%E6%97%A0%E5%8C%B9%E9%85%8D%E8%AF%8D" });
    expect(noResults.statusCode).toBe(200);
    expect(noResults.json().events).toEqual([]);
  });

  it("rejects empty search and returns typed local 404 errors", async () => {
    const search = await app!.inject({ method: "GET", url: "/api/search?q=" });
    expect(search.statusCode).toBe(400);
    expect(search.json().code).toBe("invalid_query");

    const event = await app!.inject({ method: "GET", url: "/api/events/event_missing" });
    expect(event.statusCode).toBe(404);
    expect(event.json().code).toBe("event_not_found");

    const route = await app!.inject({ method: "GET", url: "/api/not-present" });
    expect(route.statusCode).toBe(404);
  });

  it("generates, reads, and reuses an article cache", async () => {
    const missing = await app!.inject({ method: "GET", url: "/api/articles/event_fixture_shared" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("article_none");

    const generated = await app!.inject({ method: "POST", url: "/api/articles/event_fixture_shared/generate", payload: {} });
    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toMatchObject({ cache: "generated", article: { content_zh: "契约讲解正文" } });

    const hit = await app!.inject({ method: "POST", url: "/api/articles/event_fixture_shared/generate", payload: {} });
    expect(hit.json().cache).toBe("hit");
    expect(articleProvider).toHaveBeenCalledTimes(1);

    const read = await app!.inject({ method: "GET", url: "/api/articles/event_fixture_shared" });
    expect(read.statusCode).toBe(200);
    expect(read.json().article.citations[0].source_url).toBe("https://example.test/source");
  });

  it("keeps the old article when forced regeneration fails", async () => {
    await app!.inject({ method: "POST", url: "/api/articles/event_fixture_shared/generate", payload: {} });
    articleProvider.mockRejectedValueOnce(new GenerationError("offline", "fixture offline"));
    const failed = await app!.inject({ method: "POST", url: "/api/articles/event_fixture_shared/generate", payload: { force: true } });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().code).toBe("offline");
    const read = await app!.inject({ method: "GET", url: "/api/articles/event_fixture_shared" });
    expect(read.statusCode).toBe(200);
    expect(read.json().article.content_zh).toBe("契约讲解正文");
  });

  it("reports a usable no-image state without affecting the event", async () => {
    const media = await app!.inject({ method: "GET", url: "/api/media/event_fixture_shared" });
    expect(media.statusCode).toBe(200);
    expect(media.json()).toEqual({ state: "no_image", images: [] });
    const missing = await app!.inject({ method: "GET", url: "/api/media/event_missing" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: "event_not_found" });
  });

  it("rejects ephemeral QA without evidence and does not create a session", async () => {
    const response = await app!.inject({ method: "POST", url: "/api/qa/event_fixture_shared", payload: { question: "发生了什么？" } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "source_insufficient" });
    expect(response.json()).not.toHaveProperty("session_id");
  });

  it("rejects revision proposals without evidence and never applies a change", async () => {
    const response = await app!.inject({ method: "POST", url: "/api/revisions/propose", payload: { prompt: "请修正这个事件" } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "evidence_missing" });
    expect(response.json()).not.toHaveProperty("applied", true);
    const event = await app!.inject({ method: "GET", url: "/api/events/event_fixture_shared" });
    expect(event.json().event.title_zh).toBe("契约人物相关跨线共享事件");
  });
});
