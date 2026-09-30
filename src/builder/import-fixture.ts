import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFixtureCoverageReport } from "./coverage-report.js";
import { ensureParentDirectory, writeDataset } from "./dataset-files.js";
import { rebuildIndex } from "./sqlite-index.js";

const root = resolve(import.meta.dirname, "../..");
const fixturePath = resolve(root, "data/fixtures/p3-3-dataset.json");
const timelineDirectory = resolve(root, "data/timeline");
const indexPath = resolve(root, "data/index/timeline.sqlite");
const reportPath = resolve(root, "data/index/coverage-report.json");

const input: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
const dataset = writeDataset(input, timelineDirectory);
const counts = rebuildIndex(dataset, indexPath);
const report = buildFixtureCoverageReport(dataset, new Date().toISOString());
ensureParentDirectory(reportPath);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ fixture: fixturePath, index: indexPath, counts, evidence_level: report.evidence_level }));
