import { describe, expect, it } from "vitest";
import { prepareDatasetWrite } from "./validate-dataset.js";
import { p5EventInputs, p5InitialDataset } from "./p5-initial-dataset.js";

describe("P5 initial real-data sample", () => {
  it("passes the complete dataset contract with the documented sample count", () => {
    const dataset = prepareDatasetWrite(p5InitialDataset);
    expect(dataset.regions).toHaveLength(7);
    expect(dataset.periods).toHaveLength(6);
    expect(dataset.events).toHaveLength(12);
    expect(dataset.placements).toHaveLength(32);
    expect(p5EventInputs.every((event) => /^Q\d+$/.test(event.qid))).toBe(true);
  });

  it("keeps cross-region events as one event with multiple placements", () => {
    const actium = p5InitialDataset.events.find((event) => event.title_zh === "亚克兴海战")!;
    expect(actium.region_refs).toEqual(["reg_mediterranean", "reg_europe"]);
    expect(p5InitialDataset.placements.filter((placement) => placement.event_id === actium.event_id)).toHaveLength(4);
  });

  it("does not mark any first-batch sample as fully verified", () => {
    expect(new Set(p5InitialDataset.events.map((event) => event.data_status))).toEqual(new Set(["provisional", "insufficient"]));
  });

  it("keeps source calendar and broad precision on the sampled dates", () => {
    const byQid = (qid: string) => p5InitialDataset.events[p5EventInputs.findIndex((item) => item.qid === qid)]!;
    const actium = byQid("Q160387");
    expect(actium.time_span.kind === "point" && actium.time_span.at.calendar).toBe("julian");
    const maya = byQid("Q2736642");
    expect(maya.time_span.kind).toBe("range");
    if (maya.time_span.kind === "range") {
      expect(maya.time_span.start.precision).toBe("century");
      expect(maya.time_span.start.approx).toBe(true);
      expect(maya.time_span.start.year).toBe(801);
    }
    const schism = byQid("Q26189");
    expect(schism.time_span.kind === "range" && schism.time_span.end_exclusive.year).toBe(1418);
  });
});
