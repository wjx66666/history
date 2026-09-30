import { createHash } from "node:crypto";
import { join } from "node:path";
import type { EventPlacement, Period, TimelineDataset, TimelineEvent } from "../shared/timeline.js";
import { spansOverlap } from "../shared/timeline.js";
import { prepareDatasetWrite } from "./validate-dataset.js";
import { rebuildIndex } from "./sqlite-index.js";
import { RevisionTransaction, type RevisionTransactionOptions } from "./revision-transaction.js";

export class StructuralRecomputeError extends Error {
  constructor(readonly code: "placement_missing" | "placement_ambiguous", message: string) {
    super(message);
    this.name = "StructuralRecomputeError";
  }
}

function periodDepth(period: Period, byId: Map<string, Period>): number {
  let depth = 0;
  let current = period;
  const visited = new Set<string>();
  while (current.parent_period_id) {
    if (visited.has(current.period_id)) throw new StructuralRecomputeError("placement_ambiguous", `Period cycle detected: ${current.period_id}`);
    visited.add(current.period_id);
    const parent = byId.get(current.parent_period_id);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

function placementId(eventId: string, lineId: string, periodId: string): string {
  const digest = createHash("sha256").update(`${eventId}\u0000${lineId}\u0000${periodId}`).digest("hex").slice(0, 20);
  return `place_auto_${digest}`;
}

function periodsForEvent(event: TimelineEvent, periods: Period[], byId: Map<string, Period>): Period[] {
  const candidates = periods.filter((period) => period.coverage_status === "built" && spansOverlap(event.time_span, period.time_span));
  if (candidates.length === 0) throw new StructuralRecomputeError("placement_missing", `No built period contains event: ${event.event_id}`);
  const depths = candidates.map((period) => periodDepth(period, byId));
  const deepest = Math.max(...depths);
  const selected = candidates.filter((_period, index) => depths[index] === deepest);
  if (selected.length > 1) throw new StructuralRecomputeError("placement_ambiguous", `Multiple deepest periods contain event: ${event.event_id}`);
  return selected;
}

export function recomputePlacements(dataset: TimelineDataset): TimelineDataset {
  const next = structuredClone(dataset);
  const regions = new Set(next.regions.map((region) => region.region_id));
  const periods = new Map(next.periods.map((period) => [period.period_id, period]));
  const placements: EventPlacement[] = [];
  for (const event of next.events) {
    if (event.region_refs.length === 0) throw new StructuralRecomputeError("placement_missing", `Event has no region placement: ${event.event_id}`);
    const selectedPeriods = periodsForEvent(event, next.periods, periods);
    for (const [regionIndex, lineId] of event.region_refs.entries()) {
      if (!regions.has(lineId)) throw new StructuralRecomputeError("placement_missing", `Event references an unknown region: ${event.event_id}/${lineId}`);
      for (const period of selectedPeriods) {
        placements.push({
          placement_id: placementId(event.event_id, lineId, period.period_id),
          event_id: event.event_id,
          line_id: lineId,
          period_id: period.period_id,
          display_weight: regionIndex === 0 ? "primary" : "secondary",
          order_index: regionIndex,
          role: regionIndex === 0 ? "primary" : "context",
        });
      }
    }
  }
  next.placements = placements.sort((left, right) => left.event_id.localeCompare(right.event_id) || left.order_index - right.order_index || left.placement_id.localeCompare(right.placement_id));
  return prepareDatasetWrite(next);
}

export function createStructuralRevisionTransaction(options: RevisionTransactionOptions): RevisionTransaction {
  return new RevisionTransaction({
    ...options,
    transformDataset: recomputePlacements,
    prepareStaging: (dataset, stagingDirectory) => rebuildIndex(dataset, join(stagingDirectory, ".derived", "timeline.sqlite")),
  });
}
