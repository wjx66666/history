import { describe, expect, it } from "vitest";
import { estimateTextWidth, layoutLane } from "./timeline-layout";
import type { LaneItemInput, LaneLabel } from "./timeline-layout";

function item(key: string, start: number, end = start, title = key): LaneItemInput {
  return { key, eventId: `ev_${key}`, title, yearLabel: `${Math.max(1, Math.round(start))}`, start, end, isRange: end > start };
}

function eventLabels(labels: LaneLabel[]): Array<Extract<LaneLabel, { kind: "event" }>> {
  return labels.filter((label): label is Extract<LaneLabel, { kind: "event" }> => label.kind === "event");
}

function clusterLabels(labels: LaneLabel[]): Array<Extract<LaneLabel, { kind: "cluster" }>> {
  return labels.filter((label): label is Extract<LaneLabel, { kind: "cluster" }> => label.kind === "cluster");
}

describe("layoutLane", () => {
  it("places sparse items on a single layer without overlap", () => {
    const layout = layoutLane([item("a", 0), item("b", 100), item("c", 200)], 0, 300, 1200);
    const labels = eventLabels(layout.labels);
    expect(labels).toHaveLength(3);
    expect(layout.layersUsed).toBe(1);
    expect(labels.every((label) => label.layer === 0)).toBe(true);
  });

  it("stacks dense items onto bounded layers and clusters the overflow", () => {
    const dense = Array.from({ length: 10 }, (_, index) => item(`d${index}`, 50));
    const layout = layoutLane(dense, 0, 100, 800, 3);
    const placed = eventLabels(layout.labels);
    const clusters = clusterLabels(layout.labels);
    expect(placed.length).toBeLessThanOrEqual(3);
    expect(layout.layersUsed).toBeLessThanOrEqual(3);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(10 - placed.length);
    expect(clusters[0]!.keys.length).toBe(clusters[0]!.count);
    // every item is either placed or inside the cluster
    expect(placed.length + clusters[0]!.count).toBe(10);
  });

  it("never overlaps labels that share a layer", () => {
    const items = Array.from({ length: 24 }, (_, index) => item(`n${index}`, (index * 37) % 400, (index * 37) % 400, `事件标题${index}号样本`));
    const layout = layoutLane(items, 0, 400, 900, 3);
    const byLayer = new Map<number, Array<{ left: number; right: number }>>();
    for (const label of eventLabels(layout.labels)) {
      const rects = byLayer.get(label.layer) ?? [];
      rects.push({ left: label.leftPx, right: label.leftPx + label.widthPx });
      byLayer.set(label.layer, rects);
    }
    for (const rects of byLayer.values()) {
      const sorted = [...rects].sort((a, b) => a.left - b.left);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(sorted[index]!.left).toBeGreaterThanOrEqual(sorted[index - 1]!.right);
      }
    }
  });

  it("keeps label rects inside the canvas", () => {
    const items = [item("edge-a", 0), item("edge-b", 99.9), item("edge-c", 50, 50, "一个非常非常非常长的事件标题用于测试截断")];
    const layout = layoutLane(items, 0, 100, 600);
    for (const label of eventLabels(layout.labels)) {
      expect(label.leftPx).toBeGreaterThanOrEqual(0);
      expect(label.leftPx + label.widthPx).toBeLessThanOrEqual(600);
    }
  });

  it("gives zero-width ranges a visible minimum bar width", () => {
    const layout = layoutLane([{ ...item("z", 50), isRange: true }], 0, 100, 500);
    const marker = layout.markers[0]!;
    expect(marker.isRange).toBe(true);
    expect(marker.widthPct).toBeGreaterThan(0);
    expect(marker.widthPct).toBeCloseTo((5 / 500) * 100, 5);
  });

  it("clamps marker percentages to the canvas", () => {
    const layout = layoutLane([item("lo", -50), item("hi", 150, 160)], 0, 100, 500);
    for (const marker of layout.markers) {
      expect(marker.leftPct).toBeGreaterThanOrEqual(0);
      expect(marker.leftPct).toBeLessThanOrEqual(100);
      expect(marker.widthPct).toBeLessThanOrEqual(100);
    }
  });

  it("degenerates to a single cluster when the canvas is too narrow", () => {
    const items = [item("a", 10), item("b", 20), item("c", 30)];
    const layout = layoutLane(items, 0, 100, 30);
    expect(eventLabels(layout.labels)).toHaveLength(0);
    const clusters = clusterLabels(layout.labels);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(3);
    expect(layout.markers).toHaveLength(3);
  });

  it("caps long CJK titles at the maximum label width", () => {
    const layout = layoutLane([item("long", 10, 10, "这是一个非常非常非常非常非常非常非常非常长的历史事件名称")], 0, 100, 800);
    const label = eventLabels(layout.labels)[0]!;
    expect(label.widthPx).toBeLessThanOrEqual(190);
  });
});

describe("estimateTextWidth", () => {
  it("counts CJK glyphs wider than ASCII", () => {
    expect(estimateTextWidth("abcd")).toBeLessThan(estimateTextWidth("春夏秋冬"));
    expect(estimateTextWidth("")).toBe(0);
  });
});
