import type { FastifyInstance } from "fastify";
import { GenerationError } from "./model-adapter.js";
import type { EphemeralQaService } from "./ephemeral-qa.js";
import type { TimelineRepository } from "./timeline-repository.js";

function status(code: GenerationError["code"]): number {
  if (code === "rate_limited") return 429;
  if (code === "offline" || code === "provider_timeout") return 503;
  return 422;
}

export function registerQaRoutes(app: FastifyInstance, repository: TimelineRepository, qa: EphemeralQaService): void {
  app.post<{ Params: { eventId: string }; Body: { question?: unknown } }>("/api/qa/:eventId", async (request, reply) => {
    const event = repository.getEvent(request.params.eventId);
    if (!event) return reply.code(404).send({ code: "event_not_found" });
    if (typeof request.body?.question !== "string") return reply.code(400).send({ code: "invalid_request" });
    try { return { answer: await qa.ask(event.event_id, event.title_zh, request.body.question), persistence: "none" }; }
    catch (reason) {
      if (reason instanceof GenerationError) return reply.code(status(reason.code)).send({ code: reason.code, message: reason.message });
      return reply.code(500).send({ code: "qa_failed" });
    }
  });
}
