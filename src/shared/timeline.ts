export type Era = "BCE" | "CE";
export type Precision = "day" | "month" | "year" | "decade" | "century" | "unknown";
export type SortTuple = readonly [number, number, number];

export interface TemporalValue {
  calendar: string;
  era: Era;
  year: number;
  month?: number;
  day?: number;
  precision: Precision;
  approx: boolean;
  source_text: string;
  year_ordinal: number;
  sort_tuple: SortTuple;
}

export type TimeSpan =
  | { kind: "point"; at: TemporalValue }
  | { kind: "range"; start: TemporalValue; end_exclusive: TemporalValue };

export interface Region {
  region_id: string;
  name_zh: string;
  region_type: "continent" | "macro_region" | "country" | "historical_state" | "civilization" | "cultural_area" | "place";
  parent_id?: string;
  child_policy: "include" | "separate" | "manual";
}

export interface Period {
  period_id: string;
  parent_period_id?: string;
  title_zh: string;
  time_span: TimeSpan;
  scale: "era" | "century" | "decade" | "custom";
  child_ids: string[];
  expandable: boolean;
  coverage_status: "built" | "checked_empty" | "unbuilt" | "failed";
  evidence_scope?: { query: string; queried_at: string; sources: string[]; result_count: 0 };
  boundary_exception?: { reason: string; evidence_ids: string[] };
}

export interface TimelineEvent {
  event_id: string;
  title_zh: string;
  event_kind: "point_event" | "interval_event" | "war" | "process" | "disaster" | "policy" | "discovery" | "other";
  time_span: TimeSpan;
  region_refs: string[];
  data_status: "verified" | "provisional" | "disputed" | "insufficient" | "rejected";
}

export interface EventPlacement {
  placement_id: string;
  event_id: string;
  line_id: string;
  period_id: string;
  display_weight: "primary" | "secondary" | "background";
  order_index: number;
  role: "primary" | "secondary" | "context" | "commemoration";
}

export interface TimelineDataset {
  schema_version: "1.0.0";
  regions: Region[];
  periods: Period[];
  events: TimelineEvent[];
  placements: EventPlacement[];
}

export function yearOrdinal(era: Era, year: number): number {
  if (!Number.isInteger(year) || year < 1) throw new RangeError("Historical years must be positive integers; CE year 0 is invalid");
  return era === "CE" ? year : 1 - year;
}

export function expectedSortTuple(value: Pick<TemporalValue, "era" | "year" | "month" | "day">): SortTuple {
  return [yearOrdinal(value.era, value.year), value.month ?? 0, value.day ?? 0];
}

export function compareSortTuple(left: SortTuple, right: SortTuple): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

export function compareTemporal(left: TemporalValue, right: TemporalValue, leftId = "", rightId = ""): number {
  return compareSortTuple(left.sort_tuple, right.sort_tuple) || leftId.localeCompare(rightId);
}

export function spansOverlap(left: TimeSpan, right: TimeSpan): boolean {
  const leftStart = left.kind === "point" ? left.at.sort_tuple : left.start.sort_tuple;
  const rightStart = right.kind === "point" ? right.at.sort_tuple : right.start.sort_tuple;
  const leftEnd = left.kind === "point" ? left.at.sort_tuple : left.end_exclusive.sort_tuple;
  const rightEnd = right.kind === "point" ? right.at.sort_tuple : right.end_exclusive.sort_tuple;

  if (left.kind === "point" && right.kind === "point") return compareSortTuple(leftStart, rightStart) === 0;
  if (left.kind === "point") return compareSortTuple(rightStart, leftStart) <= 0 && compareSortTuple(leftStart, rightEnd) < 0;
  if (right.kind === "point") return compareSortTuple(leftStart, rightStart) <= 0 && compareSortTuple(rightStart, leftEnd) < 0;
  return compareSortTuple(leftStart, rightEnd) < 0 && compareSortTuple(rightStart, leftEnd) < 0;
}
