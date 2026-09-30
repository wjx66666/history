// Pure layout for the time matrix: positions markers by real time, stacks event
// labels into a bounded number of layers, and aggregates overflow into clusters.

export interface LaneItemInput {
  key: string;
  eventId: string;
  title: string;
  yearLabel: string;
  start: number; // fractional ordinal, see timeline-model.ts
  end: number;
  isRange: boolean;
}

export interface LaneMarker {
  key: string;
  eventId: string;
  isRange: boolean;
  leftPct: number;
  widthPct: number;
}

export type LaneLabel =
  | { kind: "event"; key: string; eventId: string; text: string; layer: number; leftPx: number; widthPx: number }
  | { kind: "cluster"; keys: string[]; eventIds: string[]; count: number; leftPx: number };

export interface LaneLayout {
  markers: LaneMarker[];
  labels: LaneLabel[];
  layersUsed: number;
}

const LABEL_FONT_PX = 12;
const LABEL_PADDING_PX = 10;
const LABEL_GAP_PX = 8;
const CLUSTER_GAP_PX = 36;
const MAX_LABEL_PX = 190;
const MIN_BAR_PX = 5;

export function estimateTextWidth(text: string): number {
  let width = 0;
  for (const char of text) width += (char.codePointAt(0) ?? 0) > 0x2e7f ? LABEL_FONT_PX + 1 : LABEL_FONT_PX * 0.55;
  return width;
}

function estimateLabelWidth(title: string, yearLabel: string, withYear: boolean): number {
  const textWidth = estimateTextWidth(title) + (withYear && yearLabel ? estimateTextWidth(yearLabel) + 14 : 0);
  return Math.min(MAX_LABEL_PX, Math.ceil(textWidth) + LABEL_PADDING_PX);
}

export function layoutLane(
  items: LaneItemInput[],
  spanStart: number,
  spanEnd: number,
  widthPx: number,
  maxLayers = 3,
): LaneLayout {
  const span = spanEnd - spanStart;
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end || a.key.localeCompare(b.key));
  if (!(widthPx >= 40) || !(span > 0)) {
    return {
      markers: sorted.map((item) => ({ key: item.key, eventId: item.eventId, isRange: item.isRange, leftPct: 0, widthPct: 0 })),
      labels: sorted.length > 0
        ? [{ kind: "cluster", keys: sorted.map((item) => item.key), eventIds: sorted.map((item) => item.eventId), count: sorted.length, leftPx: 0 }]
        : [],
      layersUsed: 0,
    };
  }

  const toPx = (value: number) => ((value - spanStart) / span) * widthPx;
  const markers: LaneMarker[] = sorted.map((item) => {
    const startPx = toPx(item.start);
    const rawWidth = item.isRange ? Math.max(toPx(item.end) - startPx, 0) : 0;
    const width = item.isRange ? Math.max(rawWidth, MIN_BAR_PX) : 0;
    return {
      key: item.key,
      eventId: item.eventId,
      isRange: item.isRange,
      leftPct: Math.max(0, Math.min(100, (startPx / widthPx) * 100)),
      widthPct: Math.min(100, (width / widthPx) * 100),
    };
  });

  // Greedy layering: a label fits a layer when its rect clears the last label there.
  const layerRightEdge: number[] = Array.from({ length: maxLayers }, () => -Infinity);
  const labels: LaneLabel[] = [];
  const overflow: Array<{ item: LaneItemInput; startPx: number }> = [];
  let layersUsed = 0;

  for (const item of sorted) {
    const startPx = Math.max(0, Math.min(widthPx, toPx(item.start)));
    let placed: LaneLabel | null = null;
    for (const withYear of [true, false]) {
      const width = estimateLabelWidth(item.title, item.yearLabel, withYear);
      for (let layer = 0; layer < maxLayers; layer += 1) {
        const left = Math.min(startPx, Math.max(0, widthPx - width - 2));
        if (left >= (layerRightEdge[layer] ?? -Infinity) + LABEL_GAP_PX) {
          layerRightEdge[layer] = left + width;
          layersUsed = Math.max(layersUsed, layer + 1);
          placed = {
            kind: "event",
            key: item.key,
            eventId: item.eventId,
            text: withYear && item.yearLabel ? `${item.title} · ${item.yearLabel}` : item.title,
            layer,
            leftPx: left,
            widthPx: width,
          };
          break;
        }
      }
      if (placed) break;
    }
    if (placed) labels.push(placed);
    else overflow.push({ item, startPx });
  }

  // Aggregate overflow into proximity clusters rendered as count badges on the track.
  let cluster: { items: LaneItemInput[]; lastPx: number } | null = null;
  const flush = () => {
    if (!cluster) return;
    const first = cluster.items[0];
    if (first) {
      labels.push({
        kind: "cluster",
        keys: cluster.items.map((entry) => entry.key),
        eventIds: cluster.items.map((entry) => entry.eventId),
        count: cluster.items.length,
        leftPx: Math.max(0, Math.min(widthPx - 40, toPx(first.start))),
      });
    }
    cluster = null;
  };
  for (const entry of overflow) {
    if (cluster && entry.startPx - cluster.lastPx < CLUSTER_GAP_PX) {
      cluster.items.push(entry.item);
      cluster.lastPx = entry.startPx;
    } else {
      flush();
      cluster = { items: [entry.item], lastPx: entry.startPx };
    }
  }
  flush();

  return { markers, labels, layersUsed };
}
