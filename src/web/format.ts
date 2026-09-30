import type { TemporalValue, TimelineEvent } from "../shared/timeline";

export function yearLabel(value: Pick<TemporalValue, "era" | "year">): string {
  return value.era === "BCE" ? `公元前 ${value.year} 年` : `公元 ${value.year} 年`;
}

export function eventDate(event: TimelineEvent): string {
  const format = (value: TemporalValue): string => {
    if (value.precision === "century") {
      const century = Math.ceil(value.year / 100);
      return `${value.approx ? "约 " : ""}${value.era === "BCE" ? "公元前 " : "公元 "}${century} 世纪`;
    }
    if (value.precision === "decade") return `${value.approx ? "约 " : ""}${yearLabel(value)}代`;
    return `${value.approx ? "约 " : ""}${yearLabel(value)}${value.month ? `${value.month} 月` : ""}${value.day ? `${value.day} 日` : ""}`;
  };
  if (event.time_span.kind === "point") return format(event.time_span.at);
  const { start, end_exclusive: end } = event.time_span;
  if (start.precision === "century" && end.precision === "century") return format(start);
  if (end.precision === "year" && !end.month && !end.day) {
    const ordinal = end.year_ordinal - 1;
    const lastYear = ordinal <= 0 ? { era: "BCE" as const, year: 1 - ordinal } : { era: "CE" as const, year: ordinal };
    return `${format(start)}至${format({ ...end, ...lastYear })}`;
  }
  if (end.precision === "day" && end.day && end.day > 1) return `${format(start)}至${format({ ...end, day: end.day - 1 })}`;
  return `${format(start)}至${format(end)}（不含终点）`;
}

export function statusLabel(status: TimelineEvent["data_status"]): string {
  const labels: Record<TimelineEvent["data_status"], string> = {
    verified: "已核验",
    provisional: "待核验",
    disputed: "有争议",
    insufficient: "来源不足",
    rejected: "已弃用",
  };
  return labels[status];
}

export function kindLabel(kind: TimelineEvent["event_kind"]): string {
  const labels: Record<TimelineEvent["event_kind"], string> = {
    point_event: "时点事件",
    interval_event: "区间事件",
    war: "战争",
    process: "进程",
    disaster: "灾害",
    policy: "政策",
    discovery: "发现",
    other: "其他",
  };
  return labels[kind];
}
