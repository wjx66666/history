import { GenerationError, type EvidenceBundle, type EvidenceRecord } from "./model-adapter.js";

export interface QaProvider {
  answer(input: { event_id: string; title_zh: string; question: string; evidence: EvidenceRecord[] }, signal: AbortSignal): Promise<unknown>;
}

export interface EphemeralAnswer {
  answer_zh: string;
  citations: Array<Pick<EvidenceRecord, "evidence_id" | "source_url" | "publisher">>;
  revision_request: { event_id: string; prompt: string } | null;
}

export class EphemeralQaService {
  constructor(
    private readonly provider: QaProvider,
    private readonly evidenceLoader: (eventId: string, titleZh: string, question: string) => Promise<EvidenceBundle>,
    private readonly timeoutMs = 60_000,
  ) {}

  async ask(eventId: string, titleZh: string, question: string): Promise<EphemeralAnswer> {
    const normalized = question.trim();
    if (normalized.length < 2 || normalized.length > 500) throw new GenerationError("schema_error", "Question must contain 2 to 500 characters");
    const bundle = await this.evidenceLoader(eventId, titleZh, normalized);
    if (bundle.evidence.length === 0) throw new GenerationError("source_insufficient", "No verifiable evidence is available for this question");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let raw: unknown;
    try {
      raw = await this.provider.answer({ event_id: eventId, title_zh: titleZh, question: normalized, evidence: structuredClone(bundle.evidence) }, controller.signal);
    } catch (reason) {
      if (controller.signal.aborted) throw new GenerationError("provider_timeout", "Question answering timed out", { cause: reason });
      if (reason instanceof GenerationError) throw reason;
      throw new GenerationError("offline", "Question answering provider is unavailable", { cause: reason });
    } finally { clearTimeout(timer); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new GenerationError("schema_error", "Answer does not match the response contract");
    const value = raw as Record<string, unknown>;
    if (typeof value.answer_zh !== "string" || value.answer_zh.trim() === "" || !Array.isArray(value.citation_ids) || !value.citation_ids.every((id) => typeof id === "string") || typeof value.revision_requested !== "boolean") {
      throw new GenerationError("schema_error", "Answer does not match the response contract");
    }
    const byId = new Map(bundle.evidence.map((item) => [item.evidence_id, item]));
    const ids = [...new Set(value.citation_ids as string[])];
    if (ids.length === 0 || ids.some((id) => !byId.has(id))) throw new GenerationError("invalid_citation", "Answer citations must resolve to supplied evidence");
    return {
      answer_zh: value.answer_zh.trim(),
      citations: ids.map((id) => { const item = byId.get(id)!; return { evidence_id: id, source_url: item.source_url, publisher: item.publisher }; }),
      revision_request: value.revision_requested ? { event_id: eventId, prompt: normalized } : null,
    };
  }
}
