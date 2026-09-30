import type { TimelineDataset } from "../shared/timeline.js";

export interface FixtureCoverageReport {
  report_id: "report_p3_3_fixture";
  batch_id: "P3-3-FIXTURE";
  dataset_version: "1.0.0";
  evidence_level: "Mock";
  generated_at: string;
  source_adapters: string[];
  counts: { regions: number; periods: number; events: number; placements: number };
  coverage_states: Record<"built" | "checked_empty" | "unbuilt" | "failed", number>;
  limitations: string[];
}

export function buildFixtureCoverageReport(dataset: TimelineDataset, generatedAt: string): FixtureCoverageReport {
  const states = { built: 0, checked_empty: 0, unbuilt: 0, failed: 0 };
  for (const period of dataset.periods) states[period.coverage_status] += 1;
  return {
    report_id: "report_p3_3_fixture",
    batch_id: "P3-3-FIXTURE",
    dataset_version: dataset.schema_version,
    evidence_level: "Mock",
    generated_at: generatedAt,
    source_adapters: ["fixture:p3-3"],
    counts: { regions: dataset.regions.length, periods: dataset.periods.length, events: dataset.events.length, placements: dataset.placements.length },
    coverage_states: states,
    limitations: ["Contract fixture only; not historical evidence.", "Does not demonstrate global, regional, or decade-level coverage."],
  };
}
