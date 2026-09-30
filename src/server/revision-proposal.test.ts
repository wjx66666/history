import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { TimelineDataset, TimelineEvent } from "../shared/timeline.js";
import type { EvidenceBundle } from "./model-adapter.js";
import { RevisionProposalError, RevisionProposalService, type RevisionProposalProvider } from "./revision-proposal.js";

const fixture = JSON.parse(readFileSync(new URL("../../data/fixtures/p3-3-dataset.json", import.meta.url), "utf8")) as TimelineDataset;
const evidence: EvidenceBundle = {
  event_id: "revision",
  title_zh: "修订证据",
  evidence: [
    { evidence_id: "evid_one", source_url: "https://example.test/one", publisher: "Fixture One", retrieved_at: "2026-09-30T00:00:00Z", claim_text: "项目侧证据一" },
    { evidence_id: "evid_two", source_url: "https://example.test/two", publisher: "Fixture Two", retrieved_at: "2026-09-30T00:00:00Z", claim_text: "项目侧证据二" },
  ],
};

const addedEvent: TimelineEvent = {
  event_id: "event_fixture_added",
  title_zh: "契约新增事件",
  event_kind: "point_event",
  time_span: { kind: "point", at: { calendar: "gregorian", era: "CE", year: 2, precision: "year", approx: false, source_text: "公元2年", year_ordinal: 2, sort_tuple: [2, 0, 0] } },
  region_refs: ["reg_fixture_east"],
  data_status: "provisional",
};

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proposal_kind: "add_event",
    summary_zh: "新增有来源的契约事件",
    changes: [{ entity_type: "event", operation: "add", entity_id: addedEvent.event_id, after: addedEvent }],
    claims: [{ change_index: 0, claim_zh: "该事件发生于公元2年", evidence_ids: ["evid_one"] }],
    entity_resolutions: [{ mention: "契约东部线", candidate_ids: ["reg_fixture_east"], resolved_id: "reg_fixture_east" }],
    disputes: [],
    ...overrides,
  };
}

function service(output: unknown, bundle = evidence, dataset: TimelineDataset = fixture): RevisionProposalService {
  const provider: RevisionProposalProvider = { propose: vi.fn(async () => output) };
  return new RevisionProposalService(provider, async () => bundle, () => structuredClone(dataset), 100);
}

describe("revision proposal validation", () => {
  it("returns a source-backed structured diff without applying it", async () => {
    const original = JSON.stringify(fixture);
    const result = await service(candidate()).propose("请新增这个事件");
    expect(result).toMatchObject({ proposal_kind: "add_event", persistence: "proposal_only", changes: [{ operation: "add", before: null, after: { event_id: "event_fixture_added" } }] });
    expect(result.claims[0]?.citations).toEqual([{ evidence_id: "evid_one", source_url: "https://example.test/one", publisher: "Fixture One" }]);
    expect(JSON.stringify(fixture)).toBe(original);
  });

  it("supports event correction and period hierarchy suggestions", async () => {
    const current = fixture.events[0]!;
    const correction = candidate({
      proposal_kind: "correct_event",
      changes: [{ entity_type: "event", operation: "replace", entity_id: current.event_id, after: { ...current, title_zh: "契约人物相关跨线共享事件（修正）" } }],
    });
    const corrected = await service(correction).propose("修正事件名称");
    expect(corrected.changes[0]?.before).toMatchObject({ event_id: current.event_id, title_zh: current.title_zh });

    const child = fixture.periods.find((period) => period.period_id === "period_fixture_child")!;
    const hierarchy = candidate({
      proposal_kind: "suggest_hierarchy",
      summary_zh: "建议调整子段尺度",
      changes: [{ entity_type: "period", operation: "replace", entity_id: child.period_id, after: { ...child, scale: "decade" } }],
    });
    const suggested = await service(hierarchy).propose("建议层级");
    expect(suggested.changes[0]?.after).toMatchObject({ period_id: child.period_id, scale: "decade" });
  });

  it("rejects missing evidence, uncovered changes, and fabricated citations", async () => {
    await expect(service(candidate(), { ...evidence, evidence: [] }).propose("新增事件")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "evidence_missing" });
    await expect(service(candidate({ claims: [] })).propose("新增事件")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "evidence_missing" });
    await expect(service(candidate({ claims: [{ change_index: 0, claim_zh: "主张", evidence_ids: ["invented"] }] })).propose("新增事件")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "invalid_citation" });
  });

  it("rejects ambiguous entities and target mismatches", async () => {
    await expect(service(candidate({ entity_resolutions: [{ mention: "同名地区", candidate_ids: ["reg_fixture_east", "reg_fixture_west"], resolved_id: null }] })).propose("新增事件")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "entity_ambiguous" });
    await expect(service(candidate({ changes: [{ entity_type: "event", operation: "add", entity_id: "wrong_id", after: addedEvent }] })).propose("新增事件")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "target_mismatch" });
    await expect(service(candidate({ proposal_kind: "adjust_period" })).propose("调整时期")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "target_mismatch" });
  });

  it("rejects invalid dates, unknown regions, and broken period boundaries", async () => {
    const invalidDate = { ...addedEvent, time_span: { kind: "point", at: { ...(addedEvent.time_span.kind === "point" ? addedEvent.time_span.at : {}), year_ordinal: 9 } } };
    await expect(service(candidate({ changes: [{ entity_type: "event", operation: "add", entity_id: invalidDate.event_id, after: invalidDate }] })).propose("新增事件")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "invariant_failed" });
    await expect(service(candidate({ changes: [{ entity_type: "event", operation: "add", entity_id: addedEvent.event_id, after: { ...addedEvent, region_refs: ["reg_unknown"] } }] })).propose("新增事件")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "invariant_failed" });
    const child = fixture.periods.find((period) => period.period_id === "period_fixture_child")!;
    const outside = { ...child, time_span: fixture.periods.find((period) => period.period_id === "period_fixture_unbuilt")!.time_span };
    await expect(service(candidate({ proposal_kind: "adjust_period", changes: [{ entity_type: "period", operation: "replace", entity_id: child.period_id, after: outside }] })).propose("调整时期")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "invariant_failed" });
  });

  it("preserves conflicting positions and requires disputed status", async () => {
    const current = fixture.events[0]!;
    const disputes = [{ change_index: 0, field: "time_span", positions: [{ value: "公元1年", evidence_ids: ["evid_one"] }, { value: "公元2年", evidence_ids: ["evid_two"] }] }];
    const proposal = candidate({
      proposal_kind: "correct_event",
      changes: [{ entity_type: "event", operation: "replace", entity_id: current.event_id, after: { ...current, data_status: "disputed" } }],
      disputes,
    });
    const result = await service(proposal).propose("保留年代争议");
    expect(result.disputes[0]?.positions).toHaveLength(2);
    const notMarked = structuredClone(proposal) as Record<string, unknown>;
    (notMarked.changes as Array<{ after: TimelineEvent }>)[0]!.after.data_status = "provisional";
    await expect(service(notMarked).propose("保留年代争议")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "invariant_failed" });
  });

  it("reports provider timeout and offline errors", async () => {
    const timeout: RevisionProposalProvider = { propose: (_input, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))) };
    await expect(new RevisionProposalService(timeout, async () => evidence, () => fixture, 5).propose("新增事件")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "provider_timeout" });
    const offline: RevisionProposalProvider = { propose: async () => { throw new Error("offline"); } };
    await expect(new RevisionProposalService(offline, async () => evidence, () => fixture).propose("新增事件")).rejects.toMatchObject<Partial<RevisionProposalError>>({ code: "offline" });
  });
});
