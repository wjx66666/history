import type { Period, TemporalValue, TimelineEvent } from "../shared/timeline";
import { spansOverlap } from "../shared/timeline";

export type DataStatus = TimelineEvent["data_status"];
export type TimelineView = "timeline" | "list";

export const ALL_STATUSES: DataStatus[] = ["verified", "provisional", "disputed", "insufficient"];
export const COMPARE_LIMIT = 3;

// year_ordinal only has year resolution; sub-year ranges (e.g. 1453-04-06..1453-05-30)
// would collapse to zero width, so positioning uses a fractional ordinal.
export function fractionalOrdinal(value: TemporalValue): number {
  return value.year_ordinal + ((value.month ?? 1) - 1) / 12 + ((value.day ?? 1) - 1) / 365;
}

export function eventRange(event: TimelineEvent): [number, number] {
  if (event.time_span.kind === "point") {
    const at = fractionalOrdinal(event.time_span.at);
    return [at, at];
  }
  const start = fractionalOrdinal(event.time_span.start);
  const end = fractionalOrdinal(event.time_span.end_exclusive);
  return [start, Math.max(end, start)];
}

export function periodRange(period: Period): [number, number] | null {
  if (period.time_span.kind !== "range") return null;
  const start = fractionalOrdinal(period.time_span.start);
  const end = fractionalOrdinal(period.time_span.end_exclusive);
  return end > start ? [start, end] : null;
}

// Compact axis label for an integer year ordinal; year_ordinal <= 0 is BCE (no year 0).
export function axisYearLabel(yearOrdinal: number): string {
  return yearOrdinal <= 0 ? `前${1 - yearOrdinal}` : `${yearOrdinal}`;
}

export interface AxisTick {
  value: number;
  position: number; // 0..1 within [start, end]
  label: string;
}

function niceStep(rawStep: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const unit = rawStep / magnitude;
  if (unit <= 1) return magnitude;
  if (unit <= 2) return 2 * magnitude;
  if (unit <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

export function buildAxisTicks(start: number, end: number, maxTicks = 8): AxisTick[] {
  if (!(end > start)) return [];
  const step = niceStep((end - start) / Math.max(1, maxTicks));
  const ticks: AxisTick[] = [];
  for (let value = Math.ceil(start / step) * step; value < end; value += step) {
    const rounded = Math.round(value) + 0; // normalize -0 from BCE spans
    if (rounded <= start || rounded >= end) continue;
    ticks.push({ value: rounded, position: (rounded - start) / (end - start), label: axisYearLabel(rounded) });
  }
  return ticks;
}

export function formatDuration(event: TimelineEvent): string {
  if (event.time_span.kind === "point") return "时点";
  const [start, end] = eventRange(event);
  const years = end - start;
  if (years < 1) return "不足 1 年";
  return `约 ${Math.round(years)} 年`;
}

export interface TimelineUrlState {
  period: string | null;
  regions: string[];
  statuses: DataStatus[];
  view: TimelineView | null;
  focus: string | null;
  compare: string[];
}

function splitList(raw: string | null): string[] {
  return raw?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
}

export function parseTimelineParams(search: string): TimelineUrlState {
  const params = new URLSearchParams(search);
  const statuses = splitList(params.get("status")).filter((value): value is DataStatus =>
    (ALL_STATUSES as string[]).includes(value));
  const view = params.get("view");
  return {
    period: params.get("period"),
    regions: splitList(params.get("regions")),
    statuses,
    view: view === "timeline" || view === "list" ? view : null,
    focus: params.get("focus"),
    compare: splitList(params.get("compare")).slice(0, COMPARE_LIMIT),
  };
}

export function serializeTimelineParams(state: TimelineUrlState): string {
  const params = new URLSearchParams();
  if (state.period) params.set("period", state.period);
  if (state.regions.length > 0) params.set("regions", state.regions.join(","));
  if (state.statuses.length > 0) params.set("status", state.statuses.join(","));
  if (state.view) params.set("view", state.view);
  if (state.focus) params.set("focus", state.focus);
  if (state.compare.length > 0) params.set("compare", state.compare.join(","));
  return params.toString();
}

export type CompareUpdate =
  | { kind: "added"; next: string[] }
  | { kind: "removed"; next: string[] }
  | { kind: "full"; next: string[] };

export function toggleCompare(current: string[], eventId: string): CompareUpdate {
  if (current.includes(eventId)) return { kind: "removed", next: current.filter((id) => id !== eventId) };
  if (current.length >= COMPARE_LIMIT) return { kind: "full", next: current };
  return { kind: "added", next: [...current, eventId] };
}

export interface ComparisonSummary {
  sharedRegionIds: string[];
  overlappingPairs: Array<[string, string]>;
}

export function comparisonSummary(events: TimelineEvent[]): ComparisonSummary {
  const sharedRegionIds: string[] = [];
  if (events.length >= 2) {
    const [first, ...rest] = events;
    for (const regionId of first?.region_refs ?? []) {
      if (rest.every((event) => event.region_refs.includes(regionId))) sharedRegionIds.push(regionId);
    }
  }
  const overlappingPairs: Array<[string, string]> = [];
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      const left = events[i];
      const right = events[j];
      if (left && right && spansOverlap(left.time_span, right.time_span)) overlappingPairs.push([left.event_id, right.event_id]);
    }
  }
  return { sharedRegionIds, overlappingPairs };
}

export function filterByStatus<T extends { event: TimelineEvent }>(items: T[], statuses: DataStatus[]): T[] {
  if (statuses.length === 0) return items;
  return items.filter((item) => statuses.includes(item.event.data_status));
}
