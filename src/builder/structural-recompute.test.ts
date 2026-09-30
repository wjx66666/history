import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Period, TemporalValue, TimelineDataset, TimelineEvent } from "../shared/timeline.js";
import type { VerifiedRevisionProposal } from "../server/revision-proposal.js";
import { TimelineRepository } from "../server/timeline-repository.js";
import { readDataset, writeDataset } from "./dataset-files.js";
import { readDatasetVersion } from "./revision-transaction.js";
import { createStructuralRevisionTransaction, recomputePlacements, StructuralRecomputeError } from "./structural-recompute.js";

const fixture = JSON.parse(readFileSync(new URL("../../data/fixtures/p3-3-dataset.json", import.meta.url), "utf8")) as TimelineDataset;
const roots: string[] = [];

function context(): { root: string; timeline: string; apply: ReturnType<typeof createStructuralRevisionTransaction> } {
  const root = mkdtempSync(join(tmpdir(), "timeline-p4-7-"));
  roots.push(root);
  const timeline = join(root, "timeline");
  writeDataset(fixture, timeline);
  return { root, timeline, apply: createStructuralRevisionTransaction({ targetDirectory: timeline, backupDirectory: join(root, "backups"), auditPath: join(root, "audit.jsonl"), lockPath: join(root, "lock"), journalPath: join(root, "journal.json") }) };
}

function proposal(kind: VerifiedRevisionProposal["proposal_kind"], change: VerifiedRevisionProposal["changes"][number]): VerifiedRevisionProposal {
  return { proposal_kind: kind, summary_zh: "结构重算测试", changes: [change], claims: [{ change_index: 0, claim_zh: "测试证据", citations: [{ evidence_id: "evid_fixture", source_url: "https://example.test/source", publisher: "Fixture" }] }], disputes: [], persistence: "proposal_only" };
}

function pointEvent(eventId: string, year: number, regionRefs = ["reg_fixture_east"]): TimelineEvent {
  return { event_id: eventId, title_zh: `契约事件${year}`, event_kind: "point_event", time_span: { kind: "point", at: { calendar: "gregorian", era: "CE", year, precision: "year", approx: false, source_text: `公元${year}年`, year_ordinal: year, sort_tuple: [year, 0, 0] } }, region_refs: regionRefs, data_status: "provisional" };
}

function ceYear(year: number): TemporalValue {
  return { calendar: "gregorian", era: "CE", year, precision: "year", approx: false, source_text: `公元${year}年`, year_ordinal: year, sort_tuple: [year, 0, 0] };
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("structural placement and index recomputation on isolated copies", () => {
  it("adds an event, recomputes its placement, and exposes it through the rebuilt index", () => {
    const ctx = context();
    const event = pointEvent("event_fixture_added", 2);
    ctx.apply.apply(proposal("add_event", { entity_type: "event", operation: "add", entity_id: event.event_id, before: null, after: event }), readDatasetVersion(ctx.timeline));
    const data = readDataset(ctx.timeline);
    expect(data.placements.find((item) => item.event_id === event.event_id)).toMatchObject({ line_id: "reg_fixture_east", period_id: "period_fixture_child" });
    const repository = new TimelineRepository(join(ctx.timeline, ".derived", "timeline.sqlite"));
    try { expect(repository.getTimelinePlacements("period_fixture_child", ["reg_fixture_east"]).map((item) => item.event.event_id)).toContain(event.event_id); } finally { repository.close(); }
  });

  it("moves a corrected event across periods and adds a second region lane", () => {
    const moved = structuredClone(fixture.events[0]!);
    moved.time_span = pointEvent("temporary", 3).time_span;
    moved.region_refs = ["reg_fixture_east", "reg_fixture_west"];
    const expanded = structuredClone(fixture);
    const root = expanded.periods.find((item) => item.period_id === "period_fixture_root")!;
    root.time_span.kind === "range" && (root.time_span.end_exclusive = { ...root.time_span.end_exclusive, year: 5, year_ordinal: 5, sort_tuple: [5, 0, 0], source_text: "公元5年（不含）" });
    const base = recomputePlacements(expanded);
    const ctx = context();
    writeDataset(base, ctx.timeline);
    ctx.apply.apply(proposal("correct_event", { entity_type: "event", operation: "replace", entity_id: moved.event_id, before: base.events[0]!, after: moved }), readDatasetVersion(ctx.timeline));
    const placements = readDataset(ctx.timeline).placements.filter((item) => item.event_id === moved.event_id);
    expect(placements).toHaveLength(2);
    expect(new Set(placements.map((item) => item.line_id))).toEqual(new Set(["reg_fixture_east", "reg_fixture_west"]));
    expect(new Set(placements.map((item) => item.period_id))).toEqual(new Set(["period_fixture_root"]));
  });

  it("reassigns routes after a child boundary change", () => {
    const ctx = context();
    const child = fixture.periods.find((item) => item.period_id === "period_fixture_child")!;
    const changed: Period = { ...child, time_span: { kind: "range", start: ceYear(2), end_exclusive: child.time_span.kind === "range" ? child.time_span.end_exclusive : neverValue() } };
    ctx.apply.apply(proposal("adjust_period", { entity_type: "period", operation: "replace", entity_id: child.period_id, before: child, after: changed }), readDatasetVersion(ctx.timeline));
    const data = readDataset(ctx.timeline);
    expect(data.placements.every((item) => item.period_id === "period_fixture_root")).toBe(true);
    const repository = new TimelineRepository(join(ctx.timeline, ".derived", "timeline.sqlite"));
    try {
      expect(repository.getTimelinePlacements("period_fixture_child", [])).toEqual([]);
      expect(repository.getTimelinePlacements("period_fixture_root", [])).toHaveLength(2);
    } finally { repository.close(); }
  });

  it("rejects missing placements and keeps the old source and route index", () => {
    const ctx = context();
    const event = pointEvent("event_fixture_orphan", 100);
    expect(() => ctx.apply.apply(proposal("add_event", { entity_type: "event", operation: "add", entity_id: event.event_id, before: null, after: event }), readDatasetVersion(ctx.timeline))).toThrowError(expect.objectContaining({ code: "write_failed", cause: expect.objectContaining<Partial<StructuralRecomputeError>>({ code: "placement_missing" }) }));
    expect(readDataset(ctx.timeline)).toEqual(fixture);
  });

  it("rejects ambiguous overlapping deepest periods atomically", () => {
    const ambiguous = structuredClone(fixture);
    ambiguous.periods.push({ ...ambiguous.periods.find((item) => item.period_id === "period_fixture_child")!, period_id: "period_fixture_sibling", parent_period_id: "period_fixture_root" });
    ambiguous.periods.find((item) => item.period_id === "period_fixture_root")!.child_ids.push("period_fixture_sibling");
    expect(() => recomputePlacements(ambiguous)).toThrowError(expect.objectContaining<Partial<StructuralRecomputeError>>({ code: "placement_ambiguous" }));
  });
});

function neverValue(): never { throw new Error("Unexpected point period fixture"); }
