import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineDataset } from "../shared/timeline.js";
import { buildFixtureCoverageReport } from "./coverage-report.js";
import { readDataset, sourceSnapshot, writeDataset } from "./dataset-files.js";
import { parseJsonLines } from "./jsonl.js";
import { readIndexCounts, rebuildIndex } from "./sqlite-index.js";

const fixturePath = new URL("../../data/fixtures/p3-3-dataset.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as TimelineDataset;
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "timeline-p3-3-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function queryIndex(path: string): { eventCount: number; placementCount: number; sharedPlacements: number; searchHits: number } {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const count = (table: string): number => (database.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: number }).count;
    const sharedPlacements = (database.prepare("SELECT count(*) count FROM placements WHERE event_id = ?").get("event_fixture_shared") as { count: number }).count;
    const searchHits = (database.prepare("SELECT count(*) count FROM event_search WHERE event_search MATCH ?").get("人物相关") as { count: number }).count;
    return { eventCount: count("events"), placementCount: count("placements"), sharedPlacements, searchHits };
  } finally {
    database.close();
  }
}

describe("P3-3 JSONL import and SQLite index", () => {
  it("writes reviewable JSONL and preserves one event across two lines", () => {
    const root = temporaryDirectory();
    const timeline = join(root, "timeline");
    const written = writeDataset(fixture, timeline);
    const readBack = readDataset(timeline);

    expect(readBack).toEqual(written);
    expect(readBack.events).toHaveLength(1);
    expect(readBack.placements).toHaveLength(2);
    expect(new Set(readBack.placements.map((item) => item.event_id))).toEqual(new Set(["event_fixture_shared"]));
    expect(readFileSync(join(timeline, "events.jsonl"), "utf8").split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("is byte-for-byte idempotent when importing the same fixture twice", () => {
    const timeline = join(temporaryDirectory(), "timeline");
    writeDataset(fixture, timeline);
    const first = sourceSnapshot(timeline);
    writeDataset(structuredClone(fixture), timeline);
    expect(sourceSnapshot(timeline)).toEqual(first);
  });

  it("rebuilds a deleted index with identical query results and FTS hits", () => {
    const root = temporaryDirectory();
    const indexPath = join(root, "index", "timeline.sqlite");
    const dataset = writeDataset(fixture, join(root, "timeline"));
    expect(rebuildIndex(dataset, indexPath)).toEqual({ regions: 2, periods: 4, events: 1, placements: 2 });
    const first = queryIndex(indexPath);
    rmSync(indexPath);
    rebuildIndex(readDataset(join(root, "timeline")), indexPath);
    expect(queryIndex(indexPath)).toEqual(first);
    expect(first).toEqual({ eventCount: 1, placementCount: 2, sharedPlacements: 2, searchHits: 1 });
  });

  it("keeps the previous index intact when replacement data cannot be indexed", () => {
    const root = temporaryDirectory();
    const indexPath = join(root, "timeline.sqlite");
    rebuildIndex(fixture, indexPath);
    const before = queryIndex(indexPath);
    const invalid = structuredClone(fixture);
    invalid.placements.push({ ...invalid.placements[0]!, placement_id: "place_fixture_duplicate" });
    expect(() => rebuildIndex(invalid, indexPath)).toThrow();
    expect(queryIndex(indexPath)).toEqual(before);
  });

  it("rejects malformed JSONL with a file and line diagnostic", () => {
    expect(() => parseJsonLines('{"ok":true}\n{"broken":}\n', "events.jsonl")).toThrow(/events\.jsonl:2/);
  });

  it("reports fixture coverage states without claiming historical coverage", () => {
    const report = buildFixtureCoverageReport(fixture, "2026-09-30T00:00:00.000Z");
    expect(report.evidence_level).toBe("Mock");
    expect(report.coverage_states).toEqual({ built: 2, checked_empty: 1, unbuilt: 1, failed: 0 });
    expect(report.limitations.join(" ")).toMatch(/not historical evidence/i);
  });

  it("can inspect an index through the shared count reader", () => {
    const path = join(temporaryDirectory(), "timeline.sqlite");
    rebuildIndex(fixture, path);
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      expect(readIndexCounts(database)).toEqual({ regions: 2, periods: 4, events: 1, placements: 2 });
    } finally {
      database.close();
    }
  });

  it("does not alter valid source files when an invalid dataset is rejected", () => {
    const timeline = join(temporaryDirectory(), "timeline");
    writeDataset(fixture, timeline);
    const before = sourceSnapshot(timeline);
    const invalid = structuredClone(fixture);
    invalid.events[0]!.event_id = "not-a-stable-id";
    expect(() => writeDataset(invalid, timeline)).toThrow(/rejected before write/i);
    expect(sourceSnapshot(timeline)).toEqual(before);
  });
});
