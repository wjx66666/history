import type { EventPlacement, Period, Region, TemporalValue, TimelineDataset, TimelineEvent } from "../shared/timeline.js";

type DateInput = { era?: "BCE" | "CE"; year: number; month?: number; day?: number; precision?: TemporalValue["precision"]; approx?: boolean; calendar?: "julian" | "gregorian" };
type EventInput = {
  id: string;
  qid: string;
  title: string;
  kind: TimelineEvent["event_kind"];
  start: DateInput;
  end?: DateInput;
  regions: string[];
  status: TimelineEvent["data_status"];
  sample: string;
};

function temporal(input: DateInput, endExclusive = false): TemporalValue {
  const era = input.era ?? "CE";
  const ordinal = era === "CE" ? input.year : 1 - input.year;
  const date = `${era === "BCE" ? "公元前" : "公元"}${input.year}年${input.month ? `${input.month}月` : ""}${input.day ? `${input.day}日` : ""}${endExclusive ? "（不含）" : ""}`;
  return {
    calendar: input.calendar ?? "gregorian",
    era,
    year: input.year,
    ...(input.month ? { month: input.month } : {}),
    ...(input.day ? { day: input.day } : {}),
    precision: input.precision ?? (input.day ? "day" : input.month ? "month" : "year"),
    approx: input.approx ?? false,
    source_text: date,
    year_ordinal: ordinal,
    sort_tuple: [ordinal, input.month ?? 0, input.day ?? 0],
  };
}

function range(start: DateInput, end: DateInput) {
  return { kind: "range" as const, start: temporal(start), end_exclusive: temporal(end, true) };
}

const regions: Region[] = [
  { region_id: "reg_east_asia", name_zh: "东亚", region_type: "macro_region", child_policy: "manual" },
  { region_id: "reg_europe", name_zh: "欧洲", region_type: "continent", child_policy: "manual" },
  { region_id: "reg_mediterranean", name_zh: "地中海", region_type: "cultural_area", child_policy: "manual" },
  { region_id: "reg_west_asia", name_zh: "西亚", region_type: "macro_region", child_policy: "manual" },
  { region_id: "reg_south_asia", name_zh: "南亚", region_type: "macro_region", child_policy: "manual" },
  { region_id: "reg_africa", name_zh: "非洲", region_type: "continent", child_policy: "manual" },
  { region_id: "reg_mesoamerica", name_zh: "中美洲与玛雅地区", region_type: "cultural_area", child_policy: "manual" },
];

const periodSpecs = [
  ["period_ancient", "古典与先秦", { era: "BCE", year: 500 }, { era: "CE", year: 1 }],
  ["period_early_medieval", "公元1至999年", { year: 1 }, { year: 1000 }],
  ["period_high_medieval", "公元1000至1499年", { year: 1000 }, { year: 1500 }],
  ["period_early_modern", "公元1500至1699年", { year: 1500 }, { year: 1700 }],
  ["period_modern", "公元1700至1900年", { year: 1700 }, { year: 1901 }],
] as const;

const periods: Period[] = [
  {
    period_id: "period_global_sample",
    title_zh: "全球历史首批真实样本",
    time_span: range({ era: "BCE", year: 500 }, { year: 1901 }),
    scale: "era",
    child_ids: periodSpecs.map(([id]) => id),
    expandable: true,
    coverage_status: "built",
  },
  ...periodSpecs.map(([period_id, title_zh, start, end]) => ({
    period_id,
    parent_period_id: "period_global_sample",
    title_zh,
    time_span: range(start, end),
    scale: "custom" as const,
    child_ids: [],
    expandable: false,
    coverage_status: "built" as const,
  })),
];

export const p5EventInputs: EventInput[] = [
  { id: "event_01jx6q3g", qid: "Q2986801", title: "秦灭六国之战", kind: "war", start: { era: "BCE", year: 230 }, end: { era: "BCE", year: 220 }, regions: ["reg_east_asia"], status: "provisional", sample: "S01" },
  { id: "event_02km8r4h", qid: "Q830059", title: "赤壁之战", kind: "point_event", start: { year: 208, calendar: "julian" }, regions: ["reg_east_asia"], status: "insufficient", sample: "S02" },
  { id: "event_03np9s5j", qid: "Q160387", title: "亚克兴海战", kind: "point_event", start: { era: "BCE", year: 31, month: 9, day: 2, calendar: "julian" }, regions: ["reg_mediterranean", "reg_europe"], status: "provisional", sample: "S04" },
  { id: "event_04qr2t6k", qid: "Q160077", title: "君士坦丁堡的陷落", kind: "war", start: { year: 1453, month: 4, day: 6, calendar: "julian" }, end: { year: 1453, month: 5, day: 30 }, regions: ["reg_europe", "reg_west_asia"], status: "insufficient", sample: "S05" },
  { id: "event_05st3v7m", qid: "Q42005", title: "黑死病", kind: "disaster", start: { year: 1346, calendar: "julian" }, end: { year: 1353, calendar: "julian" }, regions: ["reg_europe", "reg_west_asia", "reg_africa"], status: "provisional", sample: "S07" },
  { id: "event_06vw4x8n", qid: "Q12562", title: "宗教改革", kind: "process", start: { year: 1517, month: 10, day: 31, calendar: "julian" }, end: { year: 1649 }, regions: ["reg_europe"], status: "provisional", sample: "S08" },
  { id: "event_07xy5z9p", qid: "Q2487", title: "三十年战争", kind: "war", start: { year: 1618 }, end: { year: 1649 }, regions: ["reg_europe"], status: "insufficient", sample: "S09" },
  { id: "event_08za6b2q", qid: "Q26189", title: "天主教会大分裂", kind: "process", start: { year: 1378, calendar: "julian" }, end: { year: 1418 }, regions: ["reg_europe"], status: "insufficient", sample: "S10" },
  { id: "event_09bc7d3r", qid: "Q2736642", title: "古典期玛雅文明的衰落", kind: "process", start: { year: 801, precision: "century", approx: true, calendar: "julian" }, end: { year: 901, precision: "century", approx: true, calendar: "julian" }, regions: ["reg_mesoamerica"], status: "insufficient", sample: "S12" },
  { id: "event_10de8f4s", qid: "Q605321", title: "第一次帕尼帕特战役", kind: "point_event", start: { year: 1526, month: 5, day: 1, calendar: "julian" }, regions: ["reg_south_asia"], status: "insufficient", sample: "S13" },
  { id: "event_11fg9h5t", qid: "Q302519", title: "阿杜瓦战役", kind: "point_event", start: { year: 1896, month: 3, day: 1 }, regions: ["reg_africa"], status: "provisional", sample: "S14" },
  { id: "event_12hj2k6v", qid: "Q131482", title: "希吉拉", kind: "interval_event", start: { year: 622, month: 9, day: 13, calendar: "julian" }, end: { year: 622, month: 9, day: 28, calendar: "julian" }, regions: ["reg_west_asia"], status: "provisional", sample: "S15" },
];

const events: TimelineEvent[] = p5EventInputs.map((item) => ({
  event_id: item.id,
  title_zh: item.title,
  event_kind: item.kind,
  time_span: item.end ? range(item.start, item.end) : { kind: "point", at: temporal(item.start) },
  region_refs: item.regions,
  data_status: item.status,
}));

function periodFor(event: TimelineEvent): string {
  const ordinal = event.time_span.kind === "point" ? event.time_span.at.year_ordinal : event.time_span.start.year_ordinal;
  const period = periods.slice(1).find((item) => item.time_span.kind === "range" && ordinal >= item.time_span.start.year_ordinal && ordinal < item.time_span.end_exclusive.year_ordinal);
  if (!period) throw new Error(`No period for ${event.event_id}`);
  return period.period_id;
}

const placements: EventPlacement[] = events.flatMap((event, eventIndex) => event.region_refs.flatMap((region, regionIndex) => [
  { placement_id: `place_${event.event_id.slice(6)}_${region.slice(4)}_root`, event_id: event.event_id, line_id: region, period_id: "period_global_sample", display_weight: regionIndex === 0 ? "primary" : "secondary", order_index: eventIndex, role: regionIndex === 0 ? "primary" : "context" },
  { placement_id: `place_${event.event_id.slice(6)}_${region.slice(4)}_detail`, event_id: event.event_id, line_id: region, period_id: periodFor(event), display_weight: regionIndex === 0 ? "primary" : "secondary", order_index: eventIndex, role: regionIndex === 0 ? "primary" : "context" },
] as EventPlacement[]));

export const p5InitialDataset: TimelineDataset = { schema_version: "1.0.0", regions, periods, events, placements };
