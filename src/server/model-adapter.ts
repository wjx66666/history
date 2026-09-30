export type GenerationErrorCode =
  | "offline"
  | "rate_limited"
  | "provider_timeout"
  | "schema_error"
  | "source_insufficient"
  | "invalid_citation";

export interface EvidenceRecord {
  evidence_id: string;
  source_url: string;
  publisher: string;
  retrieved_at: string;
  claim_text: string;
}

export interface EvidenceBundle {
  event_id: string;
  title_zh: string;
  evidence: EvidenceRecord[];
}

export interface ArticleDraftCandidate {
  content_zh: string;
  citation_ids: string[];
  uncertainty: string | null;
}

export interface VerifiedArticleDraft extends ArticleDraftCandidate {
  citations: Array<Pick<EvidenceRecord, "evidence_id" | "source_url" | "publisher">>;
}

export interface ModelProvider {
  generateArticle(input: EvidenceBundle, signal: AbortSignal): Promise<unknown>;
}

export class GenerationError extends Error {
  constructor(readonly code: GenerationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GenerationError";
  }
}

function validateEvidence(bundle: EvidenceBundle): void {
  if (bundle.evidence.length === 0) throw new GenerationError("source_insufficient", "At least one verifiable source is required");
  const ids = new Set<string>();
  for (const evidence of bundle.evidence) {
    let url: URL;
    try {
      url = new URL(evidence.source_url);
    } catch (cause) {
      throw new GenerationError("source_insufficient", "Evidence URL is invalid", { cause });
    }
    if (!(["http:", "https:"] as string[]).includes(url.protocol) || !evidence.evidence_id || !evidence.publisher || !evidence.retrieved_at || !evidence.claim_text) {
      throw new GenerationError("source_insufficient", "Evidence is incomplete or uses an unsupported URL");
    }
    if (ids.has(evidence.evidence_id)) throw new GenerationError("source_insufficient", "Evidence IDs must be unique");
    ids.add(evidence.evidence_id);
  }
}

function parseCandidate(value: unknown): ArticleDraftCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GenerationError("schema_error", "Provider returned a non-object response");
  const record = value as Record<string, unknown>;
  if (typeof record.content_zh !== "string" || record.content_zh.trim() === "" || !Array.isArray(record.citation_ids) || !record.citation_ids.every((id) => typeof id === "string") || !(record.uncertainty === null || typeof record.uncertainty === "string")) {
    throw new GenerationError("schema_error", "Provider response does not match the article draft contract");
  }
  return {
    content_zh: record.content_zh.trim(),
    citation_ids: [...new Set(record.citation_ids)],
    uncertainty: record.uncertainty,
  };
}

function normalizeProviderError(reason: unknown): GenerationError {
  if (reason instanceof GenerationError) return reason;
  return new GenerationError("offline", "Model provider is unavailable", { cause: reason });
}

export class ArticleGenerationService {
  constructor(
    private readonly provider: ModelProvider,
    private readonly options: { timeoutMs: number; maxRetries: number },
  ) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) throw new RangeError("timeoutMs must be a positive integer");
    if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0) throw new RangeError("maxRetries must be a non-negative integer");
  }

  async generate(bundle: EvidenceBundle): Promise<VerifiedArticleDraft> {
    validateEvidence(bundle);
    let lastError: GenerationError | undefined;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const raw = await this.provider.generateArticle(structuredClone(bundle), controller.signal);
        const candidate = parseCandidate(raw);
        const byId = new Map(bundle.evidence.map((item) => [item.evidence_id, item]));
        if (candidate.citation_ids.length === 0 || candidate.citation_ids.some((id) => !byId.has(id))) {
          throw new GenerationError("invalid_citation", "Every citation must resolve to supplied evidence");
        }
        return {
          ...candidate,
          citations: candidate.citation_ids.map((id) => {
            const item = byId.get(id)!;
            return { evidence_id: item.evidence_id, source_url: item.source_url, publisher: item.publisher };
          }),
        };
      } catch (reason) {
        lastError = controller.signal.aborted
          ? new GenerationError("provider_timeout", "Model provider timed out", { cause: reason })
          : normalizeProviderError(reason);
        if (!(lastError.code === "offline" || lastError.code === "rate_limited" || lastError.code === "provider_timeout") || attempt === this.options.maxRetries) throw lastError;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new GenerationError("offline", "Model provider is unavailable");
  }
}
