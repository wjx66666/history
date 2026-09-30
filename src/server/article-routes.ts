import type { FastifyInstance } from "fastify";
import type { TimelineRepository } from "./timeline-repository.js";
import type { ArticleCache } from "./article-cache.js";
import { GenerationError } from "./model-adapter.js";

function generationStatus(code: GenerationError["code"]): number {
  if (code === "rate_limited") return 429;
  if (code === "offline" || code === "provider_timeout") return 503;
  return 422;
}

export function registerArticleRoutes(app: FastifyInstance, repository: TimelineRepository, articles: ArticleCache): void {
  app.get<{ Params: { eventId: string } }>("/api/articles/:eventId", async (request, reply) => {
    if (!repository.getEvent(request.params.eventId)) return reply.code(404).send({ code: "event_not_found" });
    try {
      const article = await articles.get(request.params.eventId);
      if (!article) return reply.code(404).send({ code: "article_none" });
      return { article, cache: "hit" };
    } catch {
      return reply.code(500).send({ code: "article_failed", message: "Article cache could not be read" });
    }
  });

  app.post<{ Params: { eventId: string }; Body: { force?: boolean } }>("/api/articles/:eventId/generate", async (request, reply) => {
    const event = repository.getEvent(request.params.eventId);
    if (!event) return reply.code(404).send({ code: "event_not_found" });
    if (request.body?.force !== undefined && typeof request.body.force !== "boolean") return reply.code(400).send({ code: "invalid_request" });
    try {
      return await articles.generate(event.event_id, event.title_zh, request.body?.force === true);
    } catch (reason) {
      if (reason instanceof GenerationError) return reply.code(generationStatus(reason.code)).send({ code: reason.code, message: reason.message });
      request.log.error(reason, "Article cache write failed");
      return reply.code(500).send({ code: "article_failed", message: "Article generation could not be saved" });
    }
  });
}
