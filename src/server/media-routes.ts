import type { FastifyInstance } from "fastify";
import type { MediaCache } from "./media-cache.js";
import type { TimelineRepository } from "./timeline-repository.js";

export function registerMediaRoutes(app: FastifyInstance, repository: TimelineRepository, media: MediaCache): void {
  app.get<{ Params: { eventId: string } }>("/api/media/:eventId", async (request, reply) => {
    if (!repository.getEvent(request.params.eventId)) return reply.code(404).send({ code: "event_not_found" });
    try {
      const images = await media.list(request.params.eventId);
      return { state: images.length > 0 ? "cached" : "no_image", images };
    } catch {
      return reply.code(500).send({ code: "media_failed" });
    }
  });

  app.get<{ Params: { eventId: string; imageId: string } }>("/api/media/:eventId/:imageId/content", async (request, reply) => {
    if (!repository.getEvent(request.params.eventId)) return reply.code(404).send({ code: "event_not_found" });
    try {
      const content = await media.content(request.params.eventId, request.params.imageId);
      if (!content) return reply.code(404).send({ code: "image_not_found" });
      return reply.type(content.metadata.mime).header("cache-control", "public, max-age=31536000, immutable").send(content.bytes);
    } catch {
      return reply.code(404).send({ code: "image_not_found" });
    }
  });
}
