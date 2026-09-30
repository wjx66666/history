import type { FastifyInstance } from "fastify";
import { GenerationError } from "./model-adapter.js";
import { RevisionProposalError, type RevisionProposalService } from "./revision-proposal.js";

export function registerRevisionRoutes(app: FastifyInstance, service: RevisionProposalService): void {
  app.post<{ Body: { prompt?: unknown } }>("/api/revisions/propose", async (request, reply) => {
    if (typeof request.body?.prompt !== "string") return reply.code(400).send({ code: "invalid_request" });
    try { return { proposal: await service.propose(request.body.prompt), applied: false }; }
    catch (reason) {
      if (reason instanceof RevisionProposalError) {
        const status = reason.code === "offline" || reason.code === "provider_timeout" ? 503 : 422;
        return reply.code(status).send({ code: reason.code, message: reason.message, issues: reason.issues });
      }
      if (reason instanceof GenerationError) return reply.code(reason.code === "offline" || reason.code === "provider_timeout" ? 503 : 422).send({ code: reason.code, message: reason.message });
      return reply.code(500).send({ code: "revision_proposal_failed" });
    }
  });
}
