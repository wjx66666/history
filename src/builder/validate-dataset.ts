import { readFileSync } from "node:fs";
import Ajv2020Module, { type ErrorObject } from "ajv/dist/2020.js";
import type { TimelineDataset, TimeSpan, TemporalValue } from "../shared/timeline.js";
import { compareSortTuple, expectedSortTuple, spansOverlap } from "../shared/timeline.js";

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; dataset: TimelineDataset }
  | { ok: false; issues: ValidationIssue[] };

const schemaDirectory = new URL("../../schemas/", import.meta.url);
const readSchema = (name: string): object => JSON.parse(readFileSync(new URL(name, schemaDirectory), "utf8")) as object;
const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": true } });
ajv.addSchema(readSchema("common.schema.json"));
ajv.addSchema(readSchema("entities.schema.json"));
const validateShape = ajv.compile<TimelineDataset>(readSchema("dataset.schema.json"));

function shapeIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    code: "SCHEMA",
    path: error.instancePath || "/",
    message: error.message ?? "schema validation failed",
  }));
}

function temporalValues(span: TimeSpan): TemporalValue[] {
  return span.kind === "point" ? [span.at] : [span.start, span.end_exclusive];
}

function validateSpan(span: TimeSpan, path: string, issues: ValidationIssue[]): void {
  for (const [index, value] of temporalValues(span).entries()) {
    const expected = expectedSortTuple(value);
    if (value.year_ordinal !== expected[0]) {
      issues.push({ code: "TIME_ORDINAL", path: `${path}/${index}/year_ordinal`, message: "year_ordinal does not match era and year" });
    }
    if (compareSortTuple(value.sort_tuple, expected) !== 0) {
      issues.push({ code: "TIME_SORT_TUPLE", path: `${path}/${index}/sort_tuple`, message: "sort_tuple does not match the derived date" });
    }
  }
  if (span.kind === "range" && compareSortTuple(span.start.sort_tuple, span.end_exclusive.sort_tuple) >= 0) {
    issues.push({ code: "TIME_RANGE", path, message: "range start must be before end_exclusive" });
  }
}

function duplicateIssues(values: readonly string[], path: string, code: string): ValidationIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) (seen.has(value) ? duplicates : seen).add(value);
  return [...duplicates].map((value) => ({ code, path, message: `duplicate ID: ${value}` }));
}

export function validateDataset(input: unknown): ValidationResult {
  if (!validateShape(input)) return { ok: false, issues: shapeIssues(validateShape.errors) };

  const dataset = input as TimelineDataset;
  const issues: ValidationIssue[] = [];
  issues.push(...duplicateIssues(dataset.regions.map((item) => item.region_id), "/regions", "DUPLICATE_ID"));
  issues.push(...duplicateIssues(dataset.periods.map((item) => item.period_id), "/periods", "DUPLICATE_ID"));
  issues.push(...duplicateIssues(dataset.events.map((item) => item.event_id), "/events", "DUPLICATE_ID"));
  issues.push(...duplicateIssues(dataset.placements.map((item) => item.placement_id), "/placements", "DUPLICATE_ID"));

  const regions = new Map(dataset.regions.map((item) => [item.region_id, item]));
  const periods = new Map(dataset.periods.map((item) => [item.period_id, item]));
  const events = new Map(dataset.events.map((item) => [item.event_id, item]));

  for (const [index, region] of dataset.regions.entries()) {
    if (region.parent_id && !regions.has(region.parent_id)) issues.push({ code: "ORPHAN_REGION", path: `/regions/${index}/parent_id`, message: `unknown parent region: ${region.parent_id}` });
  }

  for (const [index, period] of dataset.periods.entries()) {
    validateSpan(period.time_span, `/periods/${index}/time_span`, issues);
    if (period.time_span.kind !== "range") issues.push({ code: "PERIOD_RANGE", path: `/periods/${index}/time_span`, message: "period time_span must be a range" });
    const parent = period.parent_period_id ? periods.get(period.parent_period_id) : undefined;
    if (period.parent_period_id && !parent) issues.push({ code: "ORPHAN_PERIOD", path: `/periods/${index}/parent_period_id`, message: `unknown parent period: ${period.parent_period_id}` });
    if (parent && !parent.child_ids.includes(period.period_id)) issues.push({ code: "PERIOD_LINK", path: `/periods/${index}/parent_period_id`, message: "parent does not list this child" });
    if (parent && !period.boundary_exception && parent.time_span.kind === "range" && period.time_span.kind === "range") {
      const contains = compareSortTuple(parent.time_span.start.sort_tuple, period.time_span.start.sort_tuple) <= 0
        && compareSortTuple(period.time_span.end_exclusive.sort_tuple, parent.time_span.end_exclusive.sort_tuple) <= 0;
      if (!contains) issues.push({ code: "PERIOD_BOUNDARY", path: `/periods/${index}/time_span`, message: "parent period does not contain child period" });
    }
    for (const childId of period.child_ids) {
      const child = periods.get(childId);
      if (!child) issues.push({ code: "ORPHAN_PERIOD", path: `/periods/${index}/child_ids`, message: `unknown child period: ${childId}` });
      else if (child.parent_period_id !== period.period_id) issues.push({ code: "PERIOD_LINK", path: `/periods/${index}/child_ids`, message: `child ${childId} does not link back to parent` });
    }
  }

  for (const [index, event] of dataset.events.entries()) {
    validateSpan(event.time_span, `/events/${index}/time_span`, issues);
    for (const regionId of event.region_refs) if (!regions.has(regionId)) issues.push({ code: "ORPHAN_EVENT_REGION", path: `/events/${index}/region_refs`, message: `unknown region: ${regionId}` });
  }

  const placementKeys = new Set<string>();
  for (const [index, placement] of dataset.placements.entries()) {
    const event = events.get(placement.event_id);
    const period = periods.get(placement.period_id);
    if (!event) issues.push({ code: "ORPHAN_PLACEMENT", path: `/placements/${index}/event_id`, message: `unknown event: ${placement.event_id}` });
    if (!regions.has(placement.line_id)) issues.push({ code: "ORPHAN_PLACEMENT", path: `/placements/${index}/line_id`, message: `unknown line: ${placement.line_id}` });
    if (!period) issues.push({ code: "ORPHAN_PLACEMENT", path: `/placements/${index}/period_id`, message: `unknown period: ${placement.period_id}` });
    const key = `${placement.event_id}\u0000${placement.line_id}\u0000${placement.period_id}`;
    if (placementKeys.has(key)) issues.push({ code: "DUPLICATE_PLACEMENT", path: `/placements/${index}`, message: "event, line, and period placement must be unique" });
    placementKeys.add(key);
    if (event && period && !spansOverlap(event.time_span, period.time_span)) issues.push({ code: "PLACEMENT_OUTSIDE_PERIOD", path: `/placements/${index}`, message: "event time does not intersect period" });
  }

  return issues.length === 0 ? { ok: true, dataset } : { ok: false, issues };
}

export function prepareDatasetWrite(input: unknown): TimelineDataset {
  const result = validateDataset(input);
  if (!result.ok) {
    const error = new Error(`Dataset rejected before write (${result.issues.length} validation issue(s))`);
    Object.assign(error, { issues: result.issues });
    throw error;
  }
  return result.dataset;
}
