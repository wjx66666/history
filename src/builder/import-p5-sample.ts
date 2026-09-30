import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { ensureParentDirectory, writeDataset } from "./dataset-files.js";
import { rebuildIndex } from "./sqlite-index.js";
import { p5EventInputs, p5InitialDataset } from "./p5-initial-dataset.js";

const root = resolve(import.meta.dirname, "../..");
const timeline = resolve(root, "data/timeline");
const index = resolve(root, "data/index/timeline.sqlite");
const reportPath = resolve(root, "data/index/coverage-report.json");
const stamp = new Date().toISOString().replaceAll(":", "-");
const backup = resolve(root, "data/backups", `p5-initial-${stamp}`);
const staging = resolve(root, "var/tmp", `p5-initial-${process.pid}`);

const retrievedAt = "2026-09-29T00:00:00.000Z";
const evidence = p5EventInputs.map((item) => ({
  evidence_id: `evid_wikidata_${item.qid.toLowerCase()}`,
  event_id: item.id,
  source_url: `https://www.wikidata.org/wiki/${item.qid}?uselang=zh`,
  publisher: "Wikidata",
  source_type: "database",
  retrieved_at: retrievedAt,
  claim_text: `P1-2 真实只读样本 ${item.sample} 记录了“${item.title}”的实体类型、显示日期、地区与可见引用情况；尚未逐条打开外部参考来源。`,
  license: "CC0（结构化数据）；页面文字许可另见 Wikimedia 条款",
  quote_safe: false,
  sample_record: `doc/01_2026-09-29_全球历史时间线/source-sampling-p1-2.md#${item.sample}`,
}));

const sampleBatches: Record<string, string> = {
  S01: "B01", S02: "B01", S04: "B10", S05: "B11", S07: "B11", S08: "B12",
  S09: "B12", S10: "B11", S12: "B16", S13: "B06", S14: "B14", S15: "B08",
};
const batches = Array.from({ length: 18 }, (_, indexValue) => {
  const id = `B${String(indexValue + 1).padStart(2, "0")}`;
  const count = p5EventInputs.filter((item) => sampleBatches[item.sample] === id).length;
  return { batch_id: id, state: count > 0 ? "partial" : "unbuilt", accepted_event_count: count };
});

const report = {
  report_id: "report_p5_initial_real_sample",
  batch_id: "P5-INITIAL-SAMPLE",
  dataset_version: "1.0.0-p5-initial",
  evidence_level: "真实只读首批样本",
  generated_at: new Date().toISOString(),
  source_adapters: ["Wikidata entity pages via controlled manual read", "P1-2 sampling record"],
  counts: { regions: p5InitialDataset.regions.length, periods: p5InitialDataset.periods.length, events: p5InitialDataset.events.length, placements: p5InitialDataset.placements.length, evidence: evidence.length },
  batches,
  acquisition_failures: [{ source: "Wikidata Special:EntityData", attempted_at: new Date().toISOString(), reason: "30 second connection timeout; no automated retry or bypass" }],
  limitations: [
    "This is a controlled first real-data sample, not a global or complete timeline.",
    "External reference pages behind Wikidata statements were not opened; records remain provisional or insufficient.",
    "Ten of eighteen planned batches remain unbuilt, and eight populated batches are partial.",
  ],
};

try {
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  writeDataset(p5InitialDataset, staging);
  writeFileSync(resolve(staging, "evidence.jsonl"), evidence.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
  for (const name of ["relations.jsonl", "change-log.jsonl"]) {
    const source = resolve(timeline, name);
    writeFileSync(resolve(staging, name), existsSync(source) ? readFileSync(source) : "", "utf8");
  }
  rebuildIndex(p5InitialDataset, `${staging}.sqlite`);
  const indexProbe = `${index}.replace-probe`;
  if (existsSync(index)) {
    if (existsSync(indexProbe)) throw new Error(`Index probe already exists: ${indexProbe}`);
    renameSync(index, indexProbe);
    renameSync(indexProbe, index);
  }
  mkdirSync(backup, { recursive: true });
  cpSync(timeline, resolve(backup, "timeline"), { recursive: true });
  if (existsSync(index)) cpSync(index, resolve(backup, "timeline.sqlite"));
  if (existsSync(reportPath)) cpSync(reportPath, resolve(backup, "coverage-report.json"));
  const previous = `${timeline}.previous-${process.pid}`;
  try {
    renameSync(timeline, previous);
    renameSync(staging, timeline);
    ensureParentDirectory(index);
    const stagedIndex = `${staging}.sqlite`;
    rmSync(index, { force: true });
    renameSync(stagedIndex, index);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch (error) {
    if (existsSync(previous)) {
      if (existsSync(timeline)) rmSync(timeline, { recursive: true, force: true });
      renameSync(previous, timeline);
    }
    const backedUpIndex = resolve(backup, "timeline.sqlite");
    if (existsSync(backedUpIndex)) cpSync(backedUpIndex, index);
    const backedUpReport = resolve(backup, "coverage-report.json");
    if (existsSync(backedUpReport)) cpSync(backedUpReport, reportPath);
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
  const version = createHash("sha256").update(JSON.stringify(p5InitialDataset)).digest("hex");
  console.log(JSON.stringify({ backup, index, version, counts: report.counts, evidence_level: report.evidence_level }));
} finally {
  rmSync(staging, { recursive: true, force: true });
  rmSync(`${staging}.sqlite`, { force: true });
}
