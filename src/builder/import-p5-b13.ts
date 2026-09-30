import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readDataset, writeDataset } from "./dataset-files.js";
import { rebuildIndex } from "./sqlite-index.js";
import { prepareDatasetWrite } from "./validate-dataset.js";
import type { TemporalValue, TimelineEvent, EventPlacement } from "../shared/timeline.js";

const root = resolve(import.meta.dirname, "../..");
const timelinePath = resolve(root, "data/timeline");
const indexPath = resolve(root, "data/index/timeline.sqlite");
const reportPath = resolve(root, "data/index/coverage-report.json");
const stamp = new Date().toISOString().replaceAll(":", "-");
const backupPath = resolve(root, "data/backups", `p5-b13-${stamp}`);
const stagingPath = resolve(root, "var/tmp", `p5-b13-${process.pid}`);
const previousPath = `${timelinePath}.previous-${process.pid}`;

function date(year: number, month: number, day: number, sourceText: string): TemporalValue {
  return { calendar: "gregorian", era: "CE", year, month, day, precision: "day", approx: false,
    source_text: sourceText, year_ordinal: year, sort_tuple: [year, month, day] };
}

const candidates: Array<{ qid: string; event: TimelineEvent; directDateReferences: number; claim: string }> = [
  { qid: "Q6534", directDateReferences: 1, claim: "P580 1789-07-14、P582 1799-11-09；另有 P585 1789-05-05，起点取 P580，保留日期口径差异。",
    event: { event_id: "event_b13_q6534", title_zh: "法国大革命", event_kind: "process", region_refs: ["reg_europe"], data_status: "provisional",
      time_span: { kind: "range", start: date(1789, 7, 14, "P580: 1789-07-14"), end_exclusive: date(1799, 11, 10, "P582: 1799-11-09 的排他次日") } } },
  { qid: "Q48314", directDateReferences: 1, claim: "P585 1815-06-18，日精度，直接引用 1 条。",
    event: { event_id: "event_b13_q48314", title_zh: "滑铁卢之战", event_kind: "point_event", region_refs: ["reg_europe"], data_status: "provisional",
      time_span: { kind: "point", at: date(1815, 6, 18, "P585: 1815-06-18") } } },
  { qid: "Q3588", directDateReferences: 0, claim: "P580 1848-01-12、P582 1849-10-04，两个日期陈述均无直接引用。",
    event: { event_id: "event_b13_q3588", title_zh: "1848年欧洲革命", event_kind: "process", region_refs: ["reg_europe"], data_status: "insufficient",
      time_span: { kind: "range", start: date(1848, 1, 12, "P580: 1848-01-12"), end_exclusive: date(1849, 10, 5, "P582: 1849-10-04 的排他次日") } } },
  { qid: "Q46083", directDateReferences: 0, claim: "P580 1870-07-19、P582 1871-01-28，两个日期陈述均无直接引用。",
    event: { event_id: "event_b13_q46083", title_zh: "普法战争", event_kind: "war", region_refs: ["reg_europe"], data_status: "insufficient",
      time_span: { kind: "range", start: date(1870, 7, 19, "P580: 1870-07-19"), end_exclusive: date(1871, 1, 29, "P582: 1871-01-28 的排他次日") } } },
];

const original = readDataset(timelinePath);
const oldEvidence = readFileSync(resolve(timelinePath, "evidence.jsonl"), "utf8");
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  counts: { events: number; placements: number; evidence: number }; batches: Array<{ batch_id: string; state: string; accepted_event_count: number }>;
  dataset_version: string; generated_at: string; source_adapters: string[]; limitations: string[];
};
const existing = new Set(original.events.map((event) => event.event_id));
const incoming = candidates.filter(({ event }) => !existing.has(event.event_id));
if (incoming.length === 0) {
  console.log(JSON.stringify({ state: "unchanged", counts: report.counts }));
  process.exit(0);
}
if (incoming.length !== candidates.length || report.batches.find((batch) => batch.batch_id === "B13")?.accepted_event_count !== 0) {
  throw new Error("B13 is partially present; manual review required before retry");
}

const placements: EventPlacement[] = incoming.flatMap(({ event }, offset) => [
  { placement_id: `place_${event.event_id}_root`, event_id: event.event_id, line_id: "reg_europe", period_id: "period_global_sample", display_weight: "primary", order_index: original.events.length + offset, role: "primary" },
  { placement_id: `place_${event.event_id}_detail`, event_id: event.event_id, line_id: "reg_europe", period_id: "period_modern", display_weight: "primary", order_index: original.events.length + offset, role: "primary" },
]);
const dataset = prepareDatasetWrite({ ...original, events: [...original.events, ...incoming.map((item) => item.event)], placements: [...original.placements, ...placements] });
const retrievedAt = new Date().toISOString();
const evidence = incoming.map(({ qid, event, claim, directDateReferences }) => ({
  evidence_id: `evid_wikidata_${qid.toLowerCase()}`, event_id: event.event_id,
  source_url: `https://www.wikidata.org/wiki/${qid}?uselang=zh`, publisher: "Wikidata", source_type: "database",
  retrieved_at: retrievedAt, claim_text: `B13 官方 EntityData 只读：${claim} 直接引用数量不代表已核验参考网页；本条最少 ${directDateReferences} 条。`,
  license: "CC0（结构化数据）；页面文字许可另见 Wikimedia 条款", quote_safe: false,
}));
const nextReport = {
  ...report, dataset_version: "1.0.0-p5-b13-initial", generated_at: retrievedAt,
  source_adapters: [...report.source_adapters, "Wikidata Special:EntityData (B13 controlled read)"],
  counts: { ...report.counts, events: dataset.events.length, placements: dataset.placements.length, evidence: report.counts.evidence + evidence.length },
  batches: report.batches.map((batch) => batch.batch_id === "B13" ? { ...batch, state: "partial", accepted_event_count: incoming.length } : batch),
  limitations: [...report.limitations, "B13 has four initial candidates only; external references not opened and remaining units unbuilt."],
};

if (existsSync(stagingPath) || existsSync(previousPath)) throw new Error("Import staging path already exists");
let swapped = false;
try {
  mkdirSync(stagingPath, { recursive: true });
  writeDataset(dataset, stagingPath);
  writeFileSync(resolve(stagingPath, "evidence.jsonl"), oldEvidence.trimEnd() + "\n" + evidence.map((item) => JSON.stringify(item)).join("\n") + "\n");
  for (const name of ["relations.jsonl", "change-log.jsonl"]) cpSync(resolve(timelinePath, name), resolve(stagingPath, name));
  rebuildIndex(dataset, `${stagingPath}.sqlite`);
  mkdirSync(backupPath, { recursive: true });
  cpSync(timelinePath, resolve(backupPath, "timeline"), { recursive: true });
  cpSync(indexPath, resolve(backupPath, "timeline.sqlite"));
  cpSync(reportPath, resolve(backupPath, "coverage-report.json"));
  renameSync(timelinePath, previousPath);
  swapped = true;
  renameSync(stagingPath, timelinePath);
  rmSync(indexPath);
  renameSync(`${stagingPath}.sqlite`, indexPath);
  writeFileSync(reportPath, JSON.stringify(nextReport, null, 2) + "\n");
  rmSync(previousPath, { recursive: true });
  swapped = false;
  console.log(JSON.stringify({ state: "imported", backup: backupPath, counts: nextReport.counts, batch: "B13 partial" }));
} catch (error) {
  if (swapped) {
    if (existsSync(timelinePath)) rmSync(timelinePath, { recursive: true });
    renameSync(previousPath, timelinePath);
    cpSync(resolve(backupPath, "timeline.sqlite"), indexPath);
    cpSync(resolve(backupPath, "coverage-report.json"), reportPath);
  }
  throw error;
} finally {
  if (existsSync(stagingPath)) rmSync(stagingPath, { recursive: true });
  if (existsSync(`${stagingPath}.sqlite`)) rmSync(`${stagingPath}.sqlite`);
}
