import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArticleCache } from "./article-cache.js";
import { ArticleGenerationService, GenerationError, type EvidenceBundle, type ModelProvider } from "./model-adapter.js";

const directories: string[] = [];
const evidence: EvidenceBundle = {
  event_id: "event_fixture_shared",
  title_zh: "契约事件",
  evidence: [{ evidence_id: "evid_fixture", source_url: "https://example.test/evidence", publisher: "Fixture", retrieved_at: "2026-09-30T00:00:00Z", claim_text: "契约来源" }],
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createCache(generateArticle: ModelProvider["generateArticle"]) {
  const directory = await mkdtemp(join(tmpdir(), "article-cache-"));
  directories.push(directory);
  const loader = vi.fn(async () => structuredClone(evidence));
  return {
    directory,
    loader,
    cache: new ArticleCache({
      directory,
      generationService: new ArticleGenerationService({ generateArticle }, { timeoutMs: 500, maxRetries: 0 }),
      evidenceLoader: loader,
      modelProfile: { provider: "fixture", model: "fixture-v1" },
      now: () => new Date("2026-09-30T01:00:00Z"),
    }),
  };
}

describe("ArticleCache", () => {
  it("writes a validated article atomically and returns cache hits without calling the provider", async () => {
    const provider = vi.fn<ModelProvider["generateArticle"]>(async () => ({ content_zh: "缓存正文", citation_ids: ["evid_fixture"], uncertainty: null }));
    const { cache, directory } = await createCache(provider);
    const first = await cache.generate(evidence.event_id, evidence.title_zh);
    const second = await cache.generate(evidence.event_id, evidence.title_zh);
    expect(first.cache).toBe("generated");
    expect(second.cache).toBe("hit");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(join(directory, `${evidence.event_id}.json`), "utf8"))).toMatchObject({ status: "cached", content_zh: "缓存正文" });
  });

  it("coalesces concurrent generation by event ID", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const provider = vi.fn<ModelProvider["generateArticle"]>(async () => { await gate; return { content_zh: "并发正文", citation_ids: ["evid_fixture"], uncertainty: null }; });
    const { cache, loader } = await createCache(provider);
    const first = cache.generate(evidence.event_id, evidence.title_zh);
    const second = cache.generate(evidence.event_id, evidence.title_zh);
    release();
    expect((await Promise.all([first, second])).map((result) => result.article.content_zh)).toEqual(["并发正文", "并发正文"]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("replaces cache only after successful forced regeneration", async () => {
    const provider = vi.fn<ModelProvider["generateArticle"]>()
      .mockResolvedValueOnce({ content_zh: "旧正文", citation_ids: ["evid_fixture"], uncertainty: null })
      .mockRejectedValueOnce(new GenerationError("offline", "offline"))
      .mockResolvedValueOnce({ content_zh: "新正文", citation_ids: ["evid_fixture"], uncertainty: "fixture" });
    const { cache, directory } = await createCache(provider);
    await cache.generate(evidence.event_id, evidence.title_zh);
    const path = join(directory, `${evidence.event_id}.json`);
    const beforeFailure = await readFile(path, "utf8");
    await expect(cache.generate(evidence.event_id, evidence.title_zh, true)).rejects.toMatchObject({ code: "offline" });
    expect(await readFile(path, "utf8")).toBe(beforeFailure);
    const refreshed = await cache.generate(evidence.event_id, evidence.title_zh, true);
    expect(refreshed.article.content_zh).toBe("新正文");
    expect(await readFile(path, "utf8")).toContain("新正文");
  });

  it("rejects traversal-like event IDs", async () => {
    const { cache } = await createCache(async () => ({}));
    await expect(cache.get("../event_escape")).rejects.toThrow("Invalid event ID");
  });
});
