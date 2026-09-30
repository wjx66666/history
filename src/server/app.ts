import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { resolve } from "node:path";
import { TimelineRepository } from "./timeline-repository.js";
import { registerTimelineRoutes } from "./timeline-routes.js";
import { ArticleCache } from "./article-cache.js";
import { registerArticleRoutes } from "./article-routes.js";
import { ArticleGenerationService, GenerationError, type EvidenceBundle, type ModelProvider } from "./model-adapter.js";
import { MediaCache } from "./media-cache.js";
import { registerMediaRoutes } from "./media-routes.js";
import { EphemeralQaService, type QaProvider } from "./ephemeral-qa.js";
import { registerQaRoutes } from "./qa-routes.js";
import { RevisionProposalService, type RevisionProposalProvider } from "./revision-proposal.js";
import { registerRevisionRoutes } from "./revision-routes.js";
import { readDataset } from "../builder/dataset-files.js";

export interface AppOptions {
  serveWeb?: boolean;
  indexPath?: string;
  articleDirectory?: string;
  articleCache?: ArticleCache;
  mediaDirectory?: string;
  mediaCache?: MediaCache;
  qaService?: EphemeralQaService;
  revisionProposalService?: RevisionProposalService;
  timelineDirectory?: string;
}

const unavailableProvider: ModelProvider = {
  generateArticle: async () => { throw new GenerationError("offline", "No runtime model provider is configured"); },
};

async function noEvidence(eventId: string, titleZh: string): Promise<EvidenceBundle> {
  return { event_id: eventId, title_zh: titleZh, evidence: [] };
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  app.get("/api/health", async () => ({
    service: "global-history-timeline",
    status: "ok",
  }));

  const repository = new TimelineRepository(options.indexPath ?? resolve(process.cwd(), "data/index/timeline.sqlite"));
  app.addHook("onClose", () => repository.close());
  registerTimelineRoutes(app, repository);
  const articles = options.articleCache ?? new ArticleCache({
    directory: options.articleDirectory ?? resolve(process.cwd(), "data/articles"),
    generationService: new ArticleGenerationService(unavailableProvider, { timeoutMs: 60_000, maxRetries: 0 }),
    evidenceLoader: noEvidence,
    modelProfile: { provider: "unconfigured", model: "unconfigured" },
  });
  registerArticleRoutes(app, repository, articles);
  const media = options.mediaCache ?? new MediaCache({ directory: options.mediaDirectory ?? resolve(process.cwd(), "data/media") });
  registerMediaRoutes(app, repository, media);
  const qaProvider: QaProvider = { answer: async () => { throw new GenerationError("offline", "No runtime question answering provider is configured"); } };
  const qa = options.qaService ?? new EphemeralQaService(qaProvider, async (eventId, titleZh) => noEvidence(eventId, titleZh));
  registerQaRoutes(app, repository, qa);
  const revisionProvider: RevisionProposalProvider = { propose: async () => { throw new GenerationError("offline", "No runtime revision provider is configured"); } };
  const revisions = options.revisionProposalService ?? new RevisionProposalService(
    revisionProvider,
    async () => ({ event_id: "revision", title_zh: "修订提案", evidence: [] }),
    () => readDataset(options.timelineDirectory ?? resolve(process.cwd(), "data/timeline")),
  );
  registerRevisionRoutes(app, revisions);

  if (options.serveWeb) {
    await app.register(fastifyStatic, {
      root: resolve(process.cwd(), "dist-web"),
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.method === "GET" && !request.url.startsWith("/api/") && !request.url.startsWith("/assets/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ code: "route_not_found" });
    });
  }

  return app;
}
