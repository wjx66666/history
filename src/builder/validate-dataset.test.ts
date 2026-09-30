import { describe, expect, it } from "vitest";
import type { TemporalValue, TimelineDataset } from "../shared/timeline.js";
import { compareTemporal, spansOverlap, yearOrdinal } from "../shared/timeline.js";
import { prepareDatasetWrite, validateDataset } from "./validate-dataset.js";

function time(era: "BCE" | "CE", year: number, month?: number, day?: number): TemporalValue {
  const ordinal = yearOrdinal(era, year);
  return {
    calendar: "gregorian",
    era,
    year,
    ...(month === undefined ? {} : { month }),
    ...(day === undefined ? {} : { day }),
    precision: day === undefined ? (month === undefined ? "year" : "month") : "day",
    approx: false,
    source_text: `${year} ${era}`,
    year_ordinal: ordinal,
    sort_tuple: [ordinal, month ?? 0, day ?? 0],
  };
}

function validDataset(): TimelineDataset {
  return {
    schema_version: "1.0.0",
    regions: [{ region_id: "reg_world", name_zh: "世界", region_type: "continent", child_policy: "manual" }],
    periods: [
      {
        period_id: "period_root",
        title_zh: "跨公元时期",
        time_span: { kind: "range", start: time("BCE", 2), end_exclusive: time("CE", 3) },
        scale: "era",
        child_ids: ["period_child"],
        expandable: true,
        coverage_status: "built",
      },
      {
        period_id: "period_child",
        parent_period_id: "period_root",
        title_zh: "公元初期",
        time_span: { kind: "range", start: time("BCE", 1), end_exclusive: time("CE", 2) },
        scale: "custom",
        child_ids: [],
        expandable: false,
        coverage_status: "built",
      },
      {
        period_id: "period_empty",
        title_zh: "已查空段",
        time_span: { kind: "range", start: time("CE", 10), end_exclusive: time("CE", 20) },
        scale: "decade",
        child_ids: [],
        expandable: false,
        coverage_status: "checked_empty",
        evidence_scope: {
          query: "contract fixture only",
          queried_at: "2026-09-30T00:00:00Z",
          sources: ["fixture-source"],
          result_count: 0,
        },
      },
      {
        period_id: "period_unbuilt",
        title_zh: "未构建段",
        time_span: { kind: "range", start: time("CE", 20), end_exclusive: time("CE", 30) },
        scale: "decade",
        child_ids: [],
        expandable: false,
        coverage_status: "unbuilt",
      },
    ],
    events: [
      {
        event_id: "event_cross_era",
        title_zh: "契约跨公元事件",
        event_kind: "interval_event",
        time_span: { kind: "range", start: time("BCE", 1), end_exclusive: time("CE", 2) },
        region_refs: ["reg_world"],
        data_status: "provisional",
      },
    ],
    placements: [
      {
        placement_id: "place_cross_era",
        event_id: "event_cross_era",
        line_id: "reg_world",
        period_id: "period_child",
        display_weight: "primary",
        order_index: 0,
        role: "primary",
      },
    ],
  };
}

function issueCodes(input: unknown): string[] {
  const result = validateDataset(input);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe("historical chronology", () => {
  it("orders BCE through CE continuously without accepting a historical year zero", () => {
    expect(yearOrdinal("BCE", 230)).toBe(-229);
    expect(yearOrdinal("BCE", 1)).toBe(0);
    expect(yearOrdinal("CE", 1)).toBe(1);
    expect(() => yearOrdinal("CE", 0)).toThrow(/year 0/i);
    expect(compareTemporal(time("BCE", 1), time("CE", 1))).toBeLessThan(0);
  });

  it("uses stable local IDs to break equal-date ties", () => {
    const sameDate = time("CE", 2026, 9, 30);
    expect(compareTemporal(sameDate, sameDate, "event_a", "event_b")).toBeLessThan(0);
  });

  it("applies half-open overlap rules to points and ranges", () => {
    const range = { kind: "range" as const, start: time("CE", 10), end_exclusive: time("CE", 20) };
    expect(spansOverlap(range, { kind: "point", at: time("CE", 19) })).toBe(true);
    expect(spansOverlap(range, { kind: "point", at: time("CE", 20) })).toBe(false);
    expect(spansOverlap(range, { kind: "range", start: time("CE", 20), end_exclusive: time("CE", 30) })).toBe(false);
  });
});

describe("dataset contract", () => {
  it("accepts a cross-era hierarchy and keeps checked-empty distinct from unbuilt", () => {
    const result = validateDataset(validDataset());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dataset.periods.map((period) => period.coverage_status)).toContain("checked_empty");
  });

  it("rejects CE year zero and inconsistent derived chronology", () => {
    const zero = structuredClone(validDataset()) as unknown as { events: Array<{ time_span: { start: TemporalValue } }> };
    zero.events[0]!.time_span.start.year = 0;
    expect(issueCodes(zero)).toContain("SCHEMA");

    const inconsistent = validDataset();
    const event = inconsistent.events[0]!;
    if (event.time_span.kind === "range") event.time_span.start.year_ordinal = 99;
    expect(issueCodes(inconsistent)).toContain("TIME_ORDINAL");
  });

  it("rejects invalid and reversed half-open ranges", () => {
    const dataset = validDataset();
    const event = dataset.events[0]!;
    if (event.time_span.kind === "range") event.time_span.end_exclusive = event.time_span.start;
    expect(issueCodes(dataset)).toContain("TIME_RANGE");
  });

  it("rejects expandable periods without children and unchecked empty periods", () => {
    const noChildren = validDataset();
    noChildren.periods[0]!.child_ids = [];
    expect(issueCodes(noChildren)).toContain("SCHEMA");

    const noScope = validDataset();
    delete noScope.periods[2]!.evidence_scope;
    expect(issueCodes(noScope)).toContain("SCHEMA");
  });

  it("rejects orphan references and parent-child boundary violations", () => {
    const orphan = validDataset();
    orphan.placements[0]!.event_id = "event_missing";
    expect(issueCodes(orphan)).toContain("ORPHAN_PLACEMENT");

    const outside = validDataset();
    const child = outside.periods[1]!;
    child.time_span = { kind: "range", start: time("CE", 3), end_exclusive: time("CE", 4) };
    expect(issueCodes(outside)).toContain("PERIOD_BOUNDARY");
  });

  it("accepts overlapping regional placements but rejects duplicate placement keys and IDs", () => {
    const overlap = validDataset();
    overlap.regions.push({ region_id: "reg_other", name_zh: "另一线", region_type: "cultural_area", child_policy: "manual" });
    overlap.placements.push({ ...overlap.placements[0]!, placement_id: "place_other", line_id: "reg_other" });
    expect(validateDataset(overlap).ok).toBe(true);

    const duplicate = validDataset();
    duplicate.events.push(structuredClone(duplicate.events[0]!));
    duplicate.placements.push({ ...duplicate.placements[0]!, placement_id: "place_duplicate" });
    expect(issueCodes(duplicate)).toEqual(expect.arrayContaining(["DUPLICATE_ID", "DUPLICATE_PLACEMENT"]));
  });

  it("rejects non-intersecting placements before any write can proceed", () => {
    const outside = validDataset();
    outside.placements[0]!.period_id = "period_empty";
    expect(issueCodes(outside)).toContain("PLACEMENT_OUTSIDE_PERIOD");
    expect(() => prepareDatasetWrite(outside)).toThrow(/rejected before write/i);
  });
});
