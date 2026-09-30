import { validateDataset, type ValidationIssue } from "../builder/validate-dataset.js";
import type { Period, TimelineDataset, TimelineEvent } from "../shared/timeline.js";
import { GenerationError, type EvidenceBundle, type EvidenceRecord } from "./model-adapter.js";

export type RevisionKind = "add_event" | "correct_event" | "adjust_period" | "suggest_hierarchy";
type EntityType = "event" | "period";

export interface RevisionProposalProvider {
  propose(input: { prompt: string; evidence: EvidenceRecord[]; dataset: TimelineDataset }, signal: AbortSignal): Promise<unknown>;
}

export interface RevisionChange {
  entity_type: EntityType;
  operation: "add" | "replace";
  entity_id: string;
  before: TimelineEvent | Period | null;
  after: TimelineEvent | Period;
}

export interface VerifiedRevisionProposal {
  proposal_kind: RevisionKind;
  summary_zh: string;
  changes: RevisionChange[];
  claims: Array<{ change_index: number; claim_zh: string; citations: Array<Pick<EvidenceRecord, "evidence_id" | "source_url" | "publisher">> }>;
  disputes: Array<{ change_index: number; field: string; positions: Array<{ value: string; citations: Array<Pick<EvidenceRecord, "evidence_id" | "source_url" | "publisher">> }> }>;
  persistence: "proposal_only";
}

export class RevisionProposalError extends Error {
  constructor(readonly code: "schema_error" | "evidence_missing" | "invalid_citation" | "entity_ambiguous" | "target_mismatch" | "invariant_failed" | "provider_timeout" | "offline", message: string, readonly issues: ValidationIssue[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = "RevisionProposalError";
  }
}

interface CandidateChange { entity_type: EntityType; operation: "add" | "replace"; entity_id: string; after: TimelineEvent | Period }
interface CandidateClaim { change_index: number; claim_zh: string; evidence_ids: string[] }
interface CandidateDispute { change_index: number; field: string; positions: Array<{ value: string; evidence_ids: string[] }> }
interface Candidate {
  proposal_kind: RevisionKind;
  summary_zh: string;
  changes: CandidateChange[];
  claims: CandidateClaim[];
  entity_resolutions: Array<{ mention: string; candidate_ids: string[]; resolved_id: string | null }>;
  disputes: CandidateDispute[];
}

const kinds = new Set<RevisionKind>(["add_event", "correct_event", "adjust_period", "suggest_hierarchy"]);

function parseCandidate(value: unknown): Candidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RevisionProposalError("schema_error", "Proposal must be an object");
  const record = value as Record<string, unknown>;
  if (!kinds.has(record.proposal_kind as RevisionKind) || typeof record.summary_zh !== "string" || record.summary_zh.trim() === "" || !Array.isArray(record.changes) || record.changes.length === 0 || !Array.isArray(record.claims) || !Array.isArray(record.entity_resolutions) || !Array.isArray(record.disputes)) {
    throw new RevisionProposalError("schema_error", "Proposal does not match the revision contract");
  }
  for (const change of record.changes) {
    if (!change || typeof change !== "object" || Array.isArray(change)) throw new RevisionProposalError("schema_error", "Every change must be an object");
    const item = change as Record<string, unknown>;
    if (!(item.entity_type === "event" || item.entity_type === "period") || !(item.operation === "add" || item.operation === "replace") || typeof item.entity_id !== "string" || !item.after || typeof item.after !== "object" || Array.isArray(item.after)) throw new RevisionProposalError("schema_error", "Change does not match the revision contract");
  }
  for (const claim of record.claims) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) throw new RevisionProposalError("schema_error", "Every claim must be an object");
    const item = claim as Record<string, unknown>;
    if (!Number.isInteger(item.change_index) || typeof item.claim_zh !== "string" || item.claim_zh.trim() === "" || !Array.isArray(item.evidence_ids) || item.evidence_ids.length === 0 || !item.evidence_ids.every((id) => typeof id === "string")) throw new RevisionProposalError("schema_error", "Claim does not match the revision contract");
  }
  for (const resolution of record.entity_resolutions) {
    if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)) throw new RevisionProposalError("schema_error", "Every entity resolution must be an object");
    const item = resolution as Record<string, unknown>;
    if (typeof item.mention !== "string" || !Array.isArray(item.candidate_ids) || !item.candidate_ids.every((id) => typeof id === "string") || !(item.resolved_id === null || typeof item.resolved_id === "string")) throw new RevisionProposalError("schema_error", "Entity resolution does not match the revision contract");
  }
  for (const dispute of record.disputes) {
    if (!dispute || typeof dispute !== "object" || Array.isArray(dispute)) throw new RevisionProposalError("schema_error", "Every dispute must be an object");
    const item = dispute as Record<string, unknown>;
    if (!Number.isInteger(item.change_index) || typeof item.field !== "string" || !Array.isArray(item.positions) || item.positions.length < 2) throw new RevisionProposalError("schema_error", "Dispute does not match the revision contract");
    for (const position of item.positions) {
      if (!position || typeof position !== "object" || Array.isArray(position)) throw new RevisionProposalError("schema_error", "Dispute position must be an object");
      const part = position as Record<string, unknown>;
      if (typeof part.value !== "string" || !Array.isArray(part.evidence_ids) || part.evidence_ids.length === 0 || !part.evidence_ids.every((id) => typeof id === "string")) throw new RevisionProposalError("schema_error", "Dispute position does not match the revision contract");
    }
  }
  return record as unknown as Candidate;
}

function validateEvidence(bundle: EvidenceBundle): Map<string, EvidenceRecord> {
  if (bundle.evidence.length === 0) throw new RevisionProposalError("evidence_missing", "At least one project-supplied source is required");
  const result = new Map<string, EvidenceRecord>();
  for (const evidence of bundle.evidence) {
    let url: URL;
    try { url = new URL(evidence.source_url); } catch (cause) { throw new RevisionProposalError("evidence_missing", "Evidence URL is invalid", [], { cause }); }
    if (!(url.protocol === "http:" || url.protocol === "https:") || !evidence.evidence_id || !evidence.publisher || !evidence.claim_text || result.has(evidence.evidence_id)) throw new RevisionProposalError("evidence_missing", "Evidence is incomplete, duplicated, or unsupported");
    result.set(evidence.evidence_id, evidence);
  }
  return result;
}

function expectedEntityType(kind: RevisionKind): EntityType {
  return kind === "add_event" || kind === "correct_event" ? "event" : "period";
}

function validateKind(candidate: Candidate): void {
  const expected = expectedEntityType(candidate.proposal_kind);
  if (candidate.changes.some((change) => change.entity_type !== expected)) throw new RevisionProposalError("target_mismatch", "Proposal kind does not match its changed entity type");
  if (candidate.proposal_kind === "add_event" && candidate.changes.some((change) => change.operation !== "add")) throw new RevisionProposalError("target_mismatch", "add_event only permits event additions");
  if ((candidate.proposal_kind === "correct_event" || candidate.proposal_kind === "adjust_period") && candidate.changes.some((change) => change.operation !== "replace")) throw new RevisionProposalError("target_mismatch", "Correction proposals must replace existing entities");
}

function applyChanges(dataset: TimelineDataset, candidate: Candidate): RevisionChange[] {
  const working = structuredClone(dataset);
  const result: RevisionChange[] = [];
  for (const change of candidate.changes) {
    const collection = change.entity_type === "event" ? working.events : working.periods;
    const idKey = change.entity_type === "event" ? "event_id" : "period_id";
    const index = change.entity_type === "event"
      ? working.events.findIndex((item) => item.event_id === change.entity_id)
      : working.periods.findIndex((item) => item.period_id === change.entity_id);
    const afterId = (change.after as unknown as Record<string, unknown>)[idKey];
    if (afterId !== change.entity_id) throw new RevisionProposalError("target_mismatch", "Changed entity ID does not match its target");
    if (change.operation === "add" && index >= 0) throw new RevisionProposalError("target_mismatch", `Entity already exists: ${change.entity_id}`);
    if (change.operation === "replace" && index < 0) throw new RevisionProposalError("target_mismatch", `Replacement target does not exist: ${change.entity_id}`);
    const before = index >= 0 ? structuredClone(collection[index]!) : null;
    if (change.entity_type === "event" && before && (before as TimelineEvent).data_status === "disputed" && (change.after as TimelineEvent).data_status !== "disputed") throw new RevisionProposalError("invariant_failed", "A disputed event cannot be silently marked non-disputed");
    if (index >= 0) (collection as Array<TimelineEvent | Period>)[index] = structuredClone(change.after);
    else (collection as Array<TimelineEvent | Period>).push(structuredClone(change.after));
    result.push({ ...change, before, after: structuredClone(change.after) });
  }
  const validation = validateDataset(working);
  if (!validation.ok) throw new RevisionProposalError("invariant_failed", "Proposal violates dataset invariants", validation.issues);
  return result;
}

function citations(ids: string[], evidence: Map<string, EvidenceRecord>): Array<Pick<EvidenceRecord, "evidence_id" | "source_url" | "publisher">> {
  const unique = [...new Set(ids)];
  if (unique.some((id) => !evidence.has(id))) throw new RevisionProposalError("invalid_citation", "Proposal cites evidence that was not supplied by the project");
  return unique.map((id) => { const item = evidence.get(id)!; return { evidence_id: id, source_url: item.source_url, publisher: item.publisher }; });
}

export class RevisionProposalService {
  constructor(
    private readonly provider: RevisionProposalProvider,
    private readonly evidenceLoader: (prompt: string) => Promise<EvidenceBundle>,
    private readonly datasetLoader: () => Promise<TimelineDataset> | TimelineDataset,
    private readonly timeoutMs = 60_000,
  ) {}

  async propose(prompt: string): Promise<VerifiedRevisionProposal> {
    const normalized = prompt.trim();
    if (normalized.length < 2 || normalized.length > 1_000) throw new RevisionProposalError("schema_error", "Prompt must contain 2 to 1000 characters");
    const [bundle, dataset] = await Promise.all([this.evidenceLoader(normalized), this.datasetLoader()]);
    const byEvidenceId = validateEvidence(bundle);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let raw: unknown;
    try { raw = await this.provider.propose({ prompt: normalized, evidence: structuredClone(bundle.evidence), dataset: structuredClone(dataset) }, controller.signal); }
    catch (reason) {
      if (controller.signal.aborted) throw new RevisionProposalError("provider_timeout", "Revision proposal timed out", [], { cause: reason });
      if (reason instanceof RevisionProposalError || reason instanceof GenerationError) throw reason;
      throw new RevisionProposalError("offline", "Revision proposal provider is unavailable", [], { cause: reason });
    } finally { clearTimeout(timer); }
    const candidate = parseCandidate(raw);
    validateKind(candidate);
    for (const resolution of candidate.entity_resolutions) {
      if (resolution.candidate_ids.length !== 1 || resolution.resolved_id !== resolution.candidate_ids[0]) throw new RevisionProposalError("entity_ambiguous", `Entity mention is unresolved: ${resolution.mention}`);
    }
    const changes = applyChanges(dataset, candidate);
    if (changes.some((_change, index) => !candidate.claims.some((claim) => claim.change_index === index))) throw new RevisionProposalError("evidence_missing", "Every change requires at least one source-backed claim");
    if (candidate.claims.some((claim) => claim.change_index < 0 || claim.change_index >= changes.length)) throw new RevisionProposalError("target_mismatch", "A claim refers to the wrong change");
    if (candidate.disputes.some((dispute) => dispute.change_index < 0 || dispute.change_index >= changes.length)) throw new RevisionProposalError("target_mismatch", "A dispute refers to the wrong change");
    const disputes = candidate.disputes.map((dispute) => ({ ...dispute, positions: dispute.positions.map((position) => ({ value: position.value, citations: citations(position.evidence_ids, byEvidenceId) })) }));
    for (const dispute of candidate.disputes) {
      const change = changes[dispute.change_index]!;
      if (change.entity_type === "event" && (change.after as TimelineEvent).data_status !== "disputed") throw new RevisionProposalError("invariant_failed", "Conflicting positions require disputed event status");
    }
    return {
      proposal_kind: candidate.proposal_kind,
      summary_zh: candidate.summary_zh.trim(),
      changes,
      claims: candidate.claims.map((claim) => ({ change_index: claim.change_index, claim_zh: claim.claim_zh.trim(), citations: citations(claim.evidence_ids, byEvidenceId) })),
      disputes,
      persistence: "proposal_only",
    };
  }
}
