import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EventPlacement, Period, Region, TimelineDataset, TimelineEvent } from "../shared/timeline.js";
import { readJsonLines, serializeJsonLines } from "./jsonl.js";
import { prepareDatasetWrite } from "./validate-dataset.js";

const sourceFiles = {
  regions: "regions.jsonl",
  periods: "periods.jsonl",
  events: "events.jsonl",
  placements: "placements.jsonl",
} as const;

export function readDataset(directory: string): TimelineDataset {
  return prepareDatasetWrite({
    schema_version: "1.0.0",
    regions: readJsonLines<Region>(join(directory, sourceFiles.regions)),
    periods: readJsonLines<Period>(join(directory, sourceFiles.periods)),
    events: readJsonLines<TimelineEvent>(join(directory, sourceFiles.events)),
    placements: readJsonLines<EventPlacement>(join(directory, sourceFiles.placements)),
  });
}

export function writeDataset(datasetInput: unknown, directory: string): TimelineDataset {
  const dataset = prepareDatasetWrite(datasetInput);
  mkdirSync(directory, { recursive: true });
  const transactionId = `${process.pid}-${Date.now()}`;
  const writtenTemps: string[] = [];
  try {
    for (const key of Object.keys(sourceFiles) as Array<keyof typeof sourceFiles>) {
      const target = join(directory, sourceFiles[key]);
      const temporary = `${target}.${transactionId}.tmp`;
      writeFileSync(temporary, serializeJsonLines(dataset[key]), { encoding: "utf8", flag: "wx" });
      writtenTemps.push(temporary);
    }
    for (const key of Object.keys(sourceFiles) as Array<keyof typeof sourceFiles>) {
      const target = join(directory, sourceFiles[key]);
      const temporary = `${target}.${transactionId}.tmp`;
      rmSync(target, { force: true });
      renameSync(temporary, target);
    }
  } finally {
    for (const temporary of writtenTemps) rmSync(temporary, { force: true });
  }
  return dataset;
}

export function sourceSnapshot(directory: string): Record<string, string> {
  return Object.fromEntries(Object.values(sourceFiles).map((name) => [name, readFileSync(join(directory, name), "utf8")]));
}

export function ensureParentDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}
