import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineDataset, TimelineEvent } from "../shared/timeline.js";
import type { VerifiedRevisionProposal } from "../server/revision-proposal.js";
import { readDataset, writeDataset } from "./dataset-files.js";
import { readDatasetVersion, RevisionTransaction, RevisionTransactionError, SimulatedProcessInterruption } from "./revision-transaction.js";

const fixture = JSON.parse(readFileSync(new URL("../../data/fixtures/p3-3-dataset.json", import.meta.url), "utf8")) as TimelineDataset;
const roots: string[] = [];

function setup(fault?: ConstructorParameters<typeof RevisionTransaction>[0]["fault"]): { root: string; timeline: string; transaction: RevisionTransaction } {
  const root = mkdtempSync(join(tmpdir(), "timeline-p4-6-"));
  roots.push(root);
  const timeline = join(root, "timeline");
  writeDataset(fixture, timeline);
  return {
    root,
    timeline,
    transaction: new RevisionTransaction({ targetDirectory: timeline, backupDirectory: join(root, "backups"), auditPath: join(root, "audit", "revisions.jsonl"), lockPath: join(root, "revision.lock"), journalPath: join(root, "revision-journal.json"), ...(fault ? { fault } : {}), now: () => new Date("2026-09-30T00:00:00Z") }),
  };
}

function proposal(): VerifiedRevisionProposal {
  const event: TimelineEvent = {
    event_id: "event_fixture_added",
    title_zh: "事务测试新增事件",
    event_kind: "point_event",
    time_span: { kind: "point", at: { calendar: "gregorian", era: "CE", year: 2, precision: "year", approx: false, source_text: "公元2年", year_ordinal: 2, sort_tuple: [2, 0, 0] } },
    region_refs: ["reg_fixture_east"],
    data_status: "provisional",
  };
  return {
    proposal_kind: "add_event",
    summary_zh: "新增事务测试事件",
    changes: [{ entity_type: "event", operation: "add", entity_id: event.event_id, before: null, after: event }],
    claims: [{ change_index: 0, claim_zh: "测试主张", citations: [{ evidence_id: "evid_fixture", source_url: "https://example.test/source", publisher: "Fixture" }] }],
    disputes: [],
    persistence: "proposal_only",
  };
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("revision transaction on isolated source copies", () => {
  it("checks version, retains a backup, and writes structured audit records", () => {
    const { root, timeline, transaction } = setup();
    const before = readDatasetVersion(timeline);
    const result = transaction.apply(proposal(), before);
    expect(result.before_version).toBe(before);
    expect(result.after_version).not.toBe(before);
    expect(readDataset(timeline).events.map((event) => event.event_id)).toContain("event_fixture_added");
    expect(readDataset(result.backup_directory)).toEqual(fixture);
    const records = readFileSync(join(root, "audit", "revisions.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records.map((record) => record.status)).toEqual(["pending", "committed"]);
    expect(records[0].changes).toEqual([{ entity_type: "event", operation: "add", entity_id: "event_fixture_added" }]);
  });

  it("rejects stale versions and concurrent lock holders without changing data", () => {
    const stale = setup();
    expect(() => stale.transaction.apply(proposal(), "0".repeat(64))).toThrowError(expect.objectContaining({ code: "stale_version" }));
    expect(readDataset(stale.timeline)).toEqual(fixture);

    const locked = setup();
    mkdirSync(join(locked.root, "revision.lock"));
    expect(() => locked.transaction.apply(proposal(), readDatasetVersion(locked.timeline))).toThrowError(expect.objectContaining({ code: "lock_timeout" }));
    expect(readDataset(locked.timeline)).toEqual(fixture);
  });

  it("keeps old content when staging, permission, or audit preparation fails", () => {
    for (const point of ["before_stage", "before_audit"] as const) {
      const context = setup((actual) => { if (actual === point) throw new Error("injected failure"); });
      const errorCode = point === "before_audit" ? "audit_failed" : "write_failed";
      expect(() => context.transaction.apply(proposal(), readDatasetVersion(context.timeline))).toThrowError(expect.objectContaining({ code: errorCode }));
      expect(readDataset(context.timeline)).toEqual(fixture);
    }
  });

  it("rolls back replacement and audit failures after backup", () => {
    for (const point of ["after_backup", "after_replace", "before_commit_audit"] as const) {
      const context = setup((actual) => { if (actual === point) throw new Error("injected failure"); });
      expect(() => context.transaction.apply(proposal(), readDatasetVersion(context.timeline))).toThrow();
      expect(readDataset(context.timeline)).toEqual(fixture);
      expect(existsSync(join(context.root, "revision-journal.json"))).toBe(false);
    }
  });

  it("recovers a backup left by a simulated process interruption and can retry", () => {
    const context = setup((point) => { if (point === "after_backup") throw new SimulatedProcessInterruption("crash"); });
    expect(() => context.transaction.apply(proposal(), readDatasetVersion(context.timeline))).toThrow(SimulatedProcessInterruption);
    expect(existsSync(context.timeline)).toBe(false);
    const recovery = new RevisionTransaction({ targetDirectory: context.timeline, backupDirectory: join(context.root, "backups"), auditPath: join(context.root, "audit", "revisions.jsonl"), lockPath: join(context.root, "revision.lock"), journalPath: join(context.root, "revision-journal.json") });
    expect(recovery.recover()).toBe("restored_backup");
    expect(readDataset(context.timeline)).toEqual(fixture);
    const retried = recovery.apply(proposal(), readDatasetVersion(context.timeline));
    expect(retried.after_version).toBe(readDatasetVersion(context.timeline));
    expect(readDataset(context.timeline).events.map((event) => event.event_id)).toContain("event_fixture_added");
  });

  it("rejects a proposal whose reviewed before-value no longer matches", () => {
    const context = setup();
    const mismatch = proposal();
    mismatch.changes[0]!.operation = "replace";
    mismatch.changes[0]!.entity_id = fixture.events[0]!.event_id;
    mismatch.changes[0]!.before = { ...fixture.events[0]!, title_zh: "错误旧值" };
    expect(() => context.transaction.apply(mismatch, readDatasetVersion(context.timeline))).toThrowError(expect.objectContaining<Partial<RevisionTransactionError>>({ code: "proposal_mismatch" }));
    expect(readDataset(context.timeline)).toEqual(fixture);
  });
});
