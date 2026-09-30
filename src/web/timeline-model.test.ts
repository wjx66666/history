import { describe, expect, it } from "vitest";
import type { Era, TemporalValue, TimeSpan, TimelineEvent } from "../shared/timeline";
import {
  axisYearLabel,
  buildAxisTicks,
  COMPARE_LIMIT,
  comparisonSummary,
  eventRange,
  filterByStatus,
  formatDuration,
  fractionalOrdinal,
  parseTimelineParams,
  periodRange,
  serializeTimelineParams,
  toggleCompare,
} from "./timeline-model";

function temporal(yearOrdinal: number, month?: number, day?: number): TemporalValue {
  const era: Era = yearOrdinal <= 0 ? "BCE" : "CE";
  const year = yearOrdinal <= 0 ? 1 - yearOrdinal : yearOrdinal;
  return {
    calendar: "gregorian",
    era,
    year,
    ...(month === undefined ? {} : { month }),
    ...(day === undefined ? {} : { day }),
    precision: day === undefined ? (month === undefined ? "year" : "month") : "day",
    approx: false,
    source_text: "test",
    year_ordinal: yearOrdinal,
    sort_tuple: [yearOrdinal, month ?? 0, day ?? 0],
  };
}

function point(yearOrdinal: number, month?: number, day?: number): TimeSpan {
  return { kind: "point", at: temporal(yearOrdinal, month, day) };
}

function makeEvent(id: string, span: TimeSpan, regions: string[] = [], status: TimelineEvent["data_status"] = "provisional"): TimelineEvent {
  return {
    event_id: id,
    title_zh: `事件${id}`,
    event_kind: "point_event",
    time_span: span,
    region_refs: regions,
    data_status: status,
  };
}

describe("fractionalOrdinal", () => {
  it("keeps year-only values on the integer ordinal", () => {
    expect(fractionalOrdinal(temporal(1453))).toBe(1453);
    expect(fractionalOrdinal(temporal(-499))).toBe(-499);
  });

  it("separates sub-year ranges that share one year_ordinal", () => {
    const start = fractionalOrdinal(temporal(1453, 4, 6));
    const end = fractionalOrdinal(temporal(1453, 5, 30));
    expect(end).toBeGreaterThan(start);
    expect(end - start).toBeLessThan(1);
  });

  it("stays monotonic across month and year boundaries", () => {
    expect(fractionalOrdinal(temporal(622, 9, 28))).toBeLessThan(fractionalOrdinal(temporal(623)));
    expect(fractionalOrdinal(temporal(622))).toBeLessThan(fractionalOrdinal(temporal(622, 9, 13)));
  });
});

describe("eventRange", () => {
  it("returns a zero-width range for point events", () => {
    const [start, end] = eventRange(makeEvent("a", point(1453)));
    expect(start).toBe(1453);
    expect(end).toBe(1453);
  });

  it("keeps sub-year ranges non-zero", () => {
    const event = makeEvent("a", { kind: "range", start: temporal(1453, 4, 6), end_exclusive: temporal(1453, 5, 30) });
    const [start, end] = eventRange(event);
    expect(end).toBeGreaterThan(start);
  });

  it("never returns an inverted range", () => {
    const event = makeEvent("a", { kind: "range", start: temporal(1453), end_exclusive: temporal(1453) });
    const [start, end] = eventRange(event);
    expect(end).toBe(start);
  });
});

describe("periodRange", () => {
  const base = { period_id: "p", title_zh: "段", scale: "custom" as const, child_ids: [], expandable: false, coverage_status: "built" as const };
  it("returns null for point spans and inverted ranges", () => {
    expect(periodRange({ ...base, time_span: point(100) })).toBeNull();
    expect(periodRange({ ...base, time_span: { kind: "range", start: temporal(100), end_exclusive: temporal(100) } })).toBeNull();
  });
  it("returns fractional bounds for a real range", () => {
    const range = periodRange({ ...base, time_span: { kind: "range", start: temporal(-499), end_exclusive: temporal(1901) } });
    expect(range).toEqual([-499, 1901]);
  });
});

describe("axisYearLabel", () => {
  it("labels BCE ordinals without a year zero", () => {
    expect(axisYearLabel(1)).toBe("1");
    expect(axisYearLabel(0)).toBe("前1");
    expect(axisYearLabel(-499)).toBe("前500");
  });
});

describe("buildAxisTicks", () => {
  it("places round ticks strictly inside the root sample span", () => {
    const ticks = buildAxisTicks(-499, 1901);
    expect(ticks.map((tick) => tick.value)).toEqual([0, 500, 1000, 1500]);
    expect(ticks.map((tick) => tick.label)).toEqual(["前1", "500", "1000", "1500"]);
    for (const tick of ticks) {
      expect(tick.position).toBeGreaterThan(0);
      expect(tick.position).toBeLessThan(1);
    }
  });

  it("keeps ticks ascending on a decade-scale span", () => {
    const ticks = buildAxisTicks(1453, 1463, 4);
    expect(ticks.length).toBeGreaterThan(0);
    for (let index = 1; index < ticks.length; index += 1) {
      expect(ticks[index]!.value).toBeGreaterThan(ticks[index - 1]!.value);
    }
  });

  it("returns nothing for degenerate spans", () => {
    expect(buildAxisTicks(100, 100)).toEqual([]);
    expect(buildAxisTicks(200, 100)).toEqual([]);
  });
});

describe("formatDuration", () => {
  it("formats points, sub-year ranges, and multi-year ranges", () => {
    expect(formatDuration(makeEvent("a", point(1453)))).toBe("时点");
    expect(formatDuration(makeEvent("b", { kind: "range", start: temporal(1453, 4, 6), end_exclusive: temporal(1453, 5, 30) }))).toBe("不足 1 年");
    expect(formatDuration(makeEvent("c", { kind: "range", start: temporal(622), end_exclusive: temporal(632) }))).toBe("约 10 年");
  });
});

describe("timeline URL state", () => {
  it("round-trips a full state", () => {
    const raw = "period=period_ancient&regions=reg_a%2Creg_b&status=provisional&view=list&focus=ev1&compare=a%2Cb";
    const parsed = parseTimelineParams(raw);
    expect(parsed).toEqual({
      period: "period_ancient",
      regions: ["reg_a", "reg_b"],
      statuses: ["provisional"],
      view: "list",
      focus: "ev1",
      compare: ["a", "b"],
    });
    expect(serializeTimelineParams(parsed)).toBe(raw);
  });

  it("parses an empty query into defaults and serializes back to empty", () => {
    const parsed = parseTimelineParams("");
    expect(parsed).toEqual({ period: null, regions: [], statuses: [], view: null, focus: null, compare: [] });
    expect(serializeTimelineParams(parsed)).toBe("");
  });

  it("drops unknown statuses and views, and caps compare ids", () => {
    const parsed = parseTimelineParams("status=verified,bogus&view=grid&compare=a,b,c,d,e");
    expect(parsed.statuses).toEqual(["verified"]);
    expect(parsed.view).toBeNull();
    expect(parsed.compare).toEqual(["a", "b", "c"]);
  });
});

describe("toggleCompare", () => {
  it("adds, removes, and refuses beyond the limit", () => {
    expect(toggleCompare([], "a")).toEqual({ kind: "added", next: ["a"] });
    expect(toggleCompare(["a", "b"], "a")).toEqual({ kind: "removed", next: ["b"] });
    const full = toggleCompare(["a", "b", "c"], "d");
    expect(full.kind).toBe("full");
    expect(full.next).toEqual(["a", "b", "c"]);
    expect(COMPARE_LIMIT).toBe(3);
  });
});

describe("comparisonSummary", () => {
  it("reports shared regions only when every event has them", () => {
    const a = makeEvent("a", point(1453), ["reg_x", "reg_y"]);
    const b = makeEvent("b", point(1500), ["reg_x"]);
    const c = makeEvent("c", point(1600), ["reg_z"]);
    expect(comparisonSummary([a, b]).sharedRegionIds).toEqual(["reg_x"]);
    expect(comparisonSummary([a, b, c]).sharedRegionIds).toEqual([]);
    expect(comparisonSummary([a]).sharedRegionIds).toEqual([]);
  });

  it("detects overlapping pairs including point-in-range", () => {
    const siege = makeEvent("siege", { kind: "range", start: temporal(1453, 4, 6), end_exclusive: temporal(1453, 5, 30) });
    const inside = makeEvent("inside", point(1453, 5, 1));
    const outside = makeEvent("outside", point(1500));
    const summary = comparisonSummary([siege, inside, outside]);
    expect(summary.overlappingPairs).toEqual([["siege", "inside"]]);
  });
});

describe("filterByStatus", () => {
  it("passes everything through without a selection and filters otherwise", () => {
    const items = [
      { event: makeEvent("a", point(1), [], "provisional") },
      { event: makeEvent("b", point(2), [], "insufficient") },
    ];
    expect(filterByStatus(items, [])).toHaveLength(2);
    expect(filterByStatus(items, ["insufficient"]).map((item) => item.event.event_id)).toEqual(["b"]);
  });
});
