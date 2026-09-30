import type { FastifyInstance, FastifyReply } from "fastify";
import type { TimelineRepository } from "./timeline-repository.js";

function error(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ code, message });
}

function statusResponse(repository: TimelineRepository, periodId: string, reply: FastifyReply) {
  const period = repository.getPeriod(periodId);
  if (!period) return { response: error(reply, 404, "period_not_found", `Unknown period: ${periodId}`) };
  if (period.coverage_status === "unbuilt") return { response: error(reply, 409, "unbuilt", "This period has not been built") };
  if (period.coverage_status === "failed") return { response: error(reply, 503, "source_failed", "This period failed during source construction") };
  return { period };
}

export function registerTimelineRoutes(app: FastifyInstance, repository: TimelineRepository): void {
  app.get<{ Querystring: { period_id?: string; regions?: string } }>("/api/timeline", async (request, reply) => {
    const regionIds = request.query.regions?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
    const regions = repository.getRegions(regionIds);
    if (regionIds.length > 0 && regions.length !== regionIds.length) return error(reply, 404, "region_not_found", "One or more requested regions do not exist");
    if (!request.query.period_id) return { state: "built", periods: repository.getRootPeriods(), regions, placements: [] };
    const checked = statusResponse(repository, request.query.period_id, reply);
    if ("response" in checked) return checked.response;
    const period = checked.period;
    if (period.coverage_status === "checked_empty") return { state: "checked_empty", period, regions, placements: [] };
    return { state: "built", period, regions, placements: repository.getTimelinePlacements(period.period_id, regionIds) };
  });

  app.get<{ Params: { id: string } }>("/api/periods/:id", async (request, reply) => {
    const checked = statusResponse(repository, request.params.id, reply);
    if ("response" in checked) return checked.response;
    return { period: checked.period, children: repository.getChildren(checked.period.period_id) };
  });

  app.get<{ Params: { id: string } }>("/api/events/:id", async (request, reply) => {
    const eventRecord = repository.getEvent(request.params.id);
    if (!eventRecord) return error(reply, 404, "event_not_found", `Unknown event: ${request.params.id}`);
    return { event: eventRecord, placements: repository.getEventPlacements(eventRecord.event_id) };
  });

  app.get<{ Querystring: { q?: string } }>("/api/search", async (request, reply) => {
    const query = request.query.q?.trim() ?? "";
    if (query === "") return error(reply, 400, "invalid_query", "q must be a non-empty string");
    const events = repository.search(query);
    return { query, result_type: "event", events };
  });
}
