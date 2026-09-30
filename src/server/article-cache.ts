import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArticleGenerationService, EvidenceBundle, VerifiedArticleDraft } from "./model-adapter.js";

export interface CachedArticle extends VerifiedArticleDraft {
  article_id: string;
  event_id: string;
  status: "cached" | "stale";
  link_refs: Array<{ kind: "event" | "region"; target_id: string; label_zh: string }>;
  model_profile: { provider: string; model: string };
  generated_at: string;
  content_hash: string;
  source_bundle_hash: string;
}

export interface ArticleCacheOptions {
  directory: string;
  generationService: ArticleGenerationService;
  evidenceLoader: (eventId: string, titleZh: string) => Promise<EvidenceBundle>;
  modelProfile: { provider: string; model: string };
  now?: () => Date;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertEventId(eventId: string): void {
  if (!/^event_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(eventId)) throw new Error("Invalid event ID for article cache");
}

function validateCachedArticle(value: unknown, eventId: string): CachedArticle {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Article cache is malformed");
  const article = value as Partial<CachedArticle>;
  if (article.event_id !== eventId || article.article_id !== `article_${eventId}` || (article.status !== "cached" && article.status !== "stale") || typeof article.content_zh !== "string" || !Array.isArray(article.citations)) {
    throw new Error("Article cache does not match the requested event");
  }
  return article as CachedArticle;
}

export class ArticleCache {
  readonly #inFlight = new Map<string, Promise<CachedArticle>>();
  readonly #now: () => Date;

  constructor(private readonly options: ArticleCacheOptions) {
    this.#now = options.now ?? (() => new Date());
  }

  #path(eventId: string): string {
    assertEventId(eventId);
    return join(this.options.directory, `${eventId}.json`);
  }

  async get(eventId: string): Promise<CachedArticle | undefined> {
    const path = this.#path(eventId);
    try {
      return validateCachedArticle(JSON.parse(await readFile(path, "utf8")) as unknown, eventId);
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw reason;
    }
  }

  async generate(eventId: string, titleZh: string, force = false): Promise<{ article: CachedArticle; cache: "hit" | "generated" }> {
    const active = this.#inFlight.get(eventId);
    if (active) return { article: await active, cache: "generated" };

    if (!force) {
      const existing = await this.get(eventId);
      if (existing?.status === "cached") return { article: existing, cache: "hit" };
    }

    // A generation may have started while this request was reading the cache.
    const current = this.#inFlight.get(eventId);
    if (current) return { article: await current, cache: "generated" };
    const generation = this.#generateAndStore(eventId, titleZh);
    this.#inFlight.set(eventId, generation);
    try {
      return { article: await generation, cache: "generated" };
    } finally {
      if (this.#inFlight.get(eventId) === generation) this.#inFlight.delete(eventId);
    }
  }

  async #generateAndStore(eventId: string, titleZh: string): Promise<CachedArticle> {
    const bundle = await this.options.evidenceLoader(eventId, titleZh);
    const draft = await this.options.generationService.generate(bundle);
    const article: CachedArticle = {
      ...draft,
      article_id: `article_${eventId}`,
      event_id: eventId,
      status: "cached",
      link_refs: [],
      model_profile: this.options.modelProfile,
      generated_at: this.#now().toISOString(),
      content_hash: stableHash(draft.content_zh),
      source_bundle_hash: stableHash(bundle.evidence),
    };
    await mkdir(this.options.directory, { recursive: true });
    const destination = this.#path(eventId);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(article, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporary, destination);
    } catch (reason) {
      await unlink(temporary).catch(() => undefined);
      throw reason;
    }
    return article;
  }
}
