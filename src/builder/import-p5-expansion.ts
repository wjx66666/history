import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readDataset, writeDataset } from "./dataset-files.js";
import { rebuildIndex } from "./sqlite-index.js";
import { prepareDatasetWrite } from "./validate-dataset.js";
import type { EventPlacement, Region, TemporalValue, TimelineEvent } from "../shared/timeline.js";

const root = resolve(import.meta.dirname, "../..");
const timelinePath = resolve(root, "data/timeline");
const indexPath = resolve(root, "data/index/timeline.sqlite");
const reportPath = resolve(root, "data/index/coverage-report.json");
const stamp = new Date().toISOString().replaceAll(":", "-");
const backupPath = resolve(root, "data/backups", `p5-expansion-${stamp}`);
const stagingPath = resolve(root, "var/tmp", `p5-expansion-${process.pid}`);
const previousPath = `${timelinePath}.previous-${process.pid}`;

type DateSpec = [era: "BCE" | "CE", year: number, month?: number, day?: number];
type Candidate = {
  qid: string;
  title: string;
  kind: TimelineEvent["event_kind"];
  start: DateSpec;
  end?: DateSpec;
  regions: string[];
  batch: string;
  dateClaims: string;
  note: string;
  directRefs: boolean;
};

function temporal([era, year, month, day]: DateSpec, exclusive = false): TemporalValue {
  const ordinal = era === "BCE" ? 1 - year : year;
  const source = `${era === "BCE" ? "公元前" : "公元"}${year}年${month ? `${month}月` : ""}${day ? `${day}日` : ""}`;
  return {
    calendar: year < 1582 ? "julian" : "gregorian", era, year,
    ...(month ? { month } : {}), ...(day ? { day } : {}),
    precision: day ? "day" : month ? "month" : "year", approx: false,
    source_text: `${source}${exclusive ? "（排他终点，不含）" : ""}`,
    year_ordinal: ordinal, sort_tuple: [ordinal, month ?? 0, day ?? 0],
  };
}

// Dates below were read from the official EntityData P585/P580/P582 claims on 2026-09-30.
// Endpoints are exclusive local derivations; a direct Wikidata reference is not external-source verification.
export const candidates: Candidate[] = [
  { qid: "Q31900", title: "马拉松战役", kind: "point_event", start: ["BCE", 490, 9, 12], regions: ["reg_europe", "reg_mediterranean"], batch: "B10", dateClaims: "P585 -0490-09-12, preferred", note: "另有 8月12日和9月10日两个普通排序日期声明，日期存在歧义。", directRefs: true },
  { qid: "Q33745", title: "伯罗奔尼撒战争", kind: "war", start: ["BCE", 431], end: ["BCE", 404, 4, 26], regions: ["reg_europe", "reg_mediterranean"], batch: "B10", dateClaims: "P580 -0431 (year), P582 -0404-04-25", note: "起止日期无直接引用。", directRefs: false },
  { qid: "Q179670", title: "高加米拉战役", kind: "point_event", start: ["BCE", 331, 10, 1], regions: ["reg_west_asia"], batch: "B08", dateClaims: "P585 -0331-10-01", note: "日期有直接引用，但未核验引用页面。", directRefs: true },
  { qid: "Q179591", title: "坎尼会战", kind: "point_event", start: ["BCE", 216, 8, 2], regions: ["reg_europe", "reg_mediterranean"], batch: "B10", dateClaims: "P585 -0216-08-02", note: "日期有直接引用，但未核验引用页面。", directRefs: true },
  { qid: "Q492415", title: "怛罗斯战役", kind: "war", start: ["CE", 751, 5], end: ["CE", 751, 10], regions: ["reg_east_asia", "reg_west_asia"], batch: "B02", dateClaims: "P580 +0751-05 (month), P582 +0751-09 (month)", note: "起止月份无直接引用；排他终点取10月1日。", directRefs: false },
  { qid: "Q253774", title: "安史之乱", kind: "war", start: ["CE", 755, 12, 16], end: ["CE", 763, 2, 18], regions: ["reg_east_asia"], batch: "B02", dateClaims: "P580 +0755-12-16, P582 +0763-02-17", note: "日期均有直接引用；排他终点为次日。", directRefs: true },
  { qid: "Q852171", title: "蒙古侵略欧洲", kind: "war", start: ["CE", 1223], end: ["CE", 1243], regions: ["reg_europe", "reg_west_asia"], batch: "B11", dateClaims: "P580 +1223 (year), P582 +1242 (year)", note: "年精度；排他终点取1243年，有直接引用。", directRefs: true },
  { qid: "Q233568", title: "哈丁战役", kind: "war", start: ["CE", 1187, 7, 3], end: ["CE", 1187, 7, 5], regions: ["reg_west_asia"], batch: "B09", dateClaims: "P580 +1187-07-03, P582 +1187-07-04", note: "两日日期无直接引用；排他终点为7月5日。", directRefs: false },
  { qid: "Q203233", title: "普拉西战役", kind: "point_event", start: ["CE", 1757, 6, 23], regions: ["reg_south_asia"], batch: "B07", dateClaims: "P585 +1757-06-23", note: "日期有直接引用，但未核验引用页面。", directRefs: true },
  { qid: "Q40949", title: "美国独立战争", kind: "war", start: ["CE", 1775, 4, 19], end: ["CE", 1783, 9, 4], regions: ["reg_north_america"], batch: "B18", dateClaims: "P580 +1775-04-19, P582 +1783-09-03", note: "起止日期无直接引用；排他终点为次日。", directRefs: false },
];

const original = readDataset(timelinePath);
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  counts: { regions: number; events: number; placements: number; evidence: number };
  batches: Array<{ batch_id: string; state: string; accepted_event_count: number }>;
  source_adapters: string[]; limitations: string[];
};
const existing = new Set(original.events.map((event) => event.event_id));
const incoming = candidates.filter((item) => !existing.has(`event_p5_${item.qid.toLowerCase()}`));
if (incoming.length === 0) {
  console.log(JSON.stringify({ state: "unchanged", counts: report.counts }));
  process.exit(0);
}
if (incoming.length !== candidates.length) throw new Error("Expansion is partially present; manual review required");

const newRegion: Region = { region_id: "reg_north_america", name_zh: "北美洲", region_type: "continent", child_policy: "manual" };
if (original.regions.some((region) => region.region_id === newRegion.region_id)) throw new Error("North America region already exists; manual review required");
const periods = original.periods.filter((period) => period.parent_period_id === "period_global_sample");
const events: TimelineEvent[] = incoming.map((item) => ({
  event_id: `event_p5_${item.qid.toLowerCase()}`, title_zh: item.title,
  event_kind: item.kind, region_refs: item.regions,
  data_status: item.directRefs && item.qid !== "Q31900" ? "provisional" : "insufficient",
  time_span: item.end ? { kind: "range", start: temporal(item.start), end_exclusive: temporal(item.end, true) } : { kind: "point", at: temporal(item.start) },
}));
const placements: EventPlacement[] = events.flatMap((event, offset) => {
  const start = event.time_span.kind === "point" ? event.time_span.at.year_ordinal : event.time_span.start.year_ordinal;
  const period = periods.find((item) => item.time_span.kind === "range" && start >= item.time_span.start.year_ordinal && start < item.time_span.end_exclusive.year_ordinal);
  if (!period) throw new Error(`No child period for ${event.event_id}`);
  return event.region_refs.flatMap((region, regionIndex) => ["period_global_sample", period.period_id].map((periodId): EventPlacement => ({
    placement_id: `place_${event.event_id}_${region}_${periodId}`, event_id: event.event_id,
    line_id: region, period_id: periodId,
    display_weight: regionIndex === 0 ? "primary" : "secondary",
    order_index: original.events.length + offset,
    role: regionIndex === 0 ? "primary" : "context",
  })));
});
const dataset = prepareDatasetWrite({ ...original, regions: [...original.regions, newRegion], events: [...original.events, ...events], placements: [...original.placements, ...placements] });
const retrievedAt = new Date().toISOString();
const evidence = incoming.map((item) => ({
  evidence_id: `evid_wikidata_${item.qid.toLowerCase()}`, event_id: `event_p5_${item.qid.toLowerCase()}`,
  source_url: `https://www.wikidata.org/wiki/Special:EntityData/${item.qid}.json`,
  publisher: "Wikidata", source_type: "database", retrieved_at: retrievedAt,
  claim_text: `2026-09-30 官方 EntityData 只读：${item.dateClaims}。${item.note} 仅据实体日期陈述与关联地区初步放置，外部参考未核验。`,
  license: "CC0（结构化数据）；页面文字许可另见 Wikimedia 条款", quote_safe: false,
}));
const counts = { ...report.counts, regions: dataset.regions.length, events: dataset.events.length, placements: dataset.placements.length, evidence: report.counts.evidence + evidence.length };
const nextReport = {
  ...report, dataset_version: "1.0.0-p5-expansion", generated_at: retrievedAt, counts,
  source_adapters: [...report.source_adapters, "Wikidata Special:EntityData (10 controlled reads, 2026-09-30)"],
  batches: report.batches.map((batch) => {
    const added = incoming.filter((item) => item.batch === batch.batch_id).length;
    return added ? { ...batch, state: "partial", accepted_event_count: batch.accepted_event_count + added } : batch;
  }),
  limitations: [...report.limitations, "Ten additional EntityData date claims were sampled; several have no direct references or conflicting dates. Coverage remains partial; external references and region mapping need further review."],
};

if (existsSync(stagingPath) || existsSync(previousPath)) throw new Error("Import staging path already exists");
let swapped = false;
try {
  mkdirSync(stagingPath, { recursive: true });
  writeDataset(dataset, stagingPath);
  const oldEvidence = readFileSync(resolve(timelinePath, "evidence.jsonl"), "utf8");
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
  console.log(JSON.stringify({ state: "imported", backup: backupPath, counts, batches: nextReport.batches }));
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
