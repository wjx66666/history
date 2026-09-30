import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { EventPlacement, Period, Region, TimelineEvent } from "../shared/timeline.js";

export type TimelineState = "built" | "checked_empty" | "unbuilt" | "failed";

interface PlacementRow extends EventPlacement {
  event_json: string;
  region_json: string;
}

function parseRecord<T>(value: string): T {
  return JSON.parse(value) as T;
}

export class TimelineRepository {
  readonly #database: DatabaseSync;

  constructor(indexPath: string) {
    if (!existsSync(indexPath)) throw new Error(`Timeline index does not exist: ${indexPath}`);
    this.#database = new DatabaseSync(indexPath, { readOnly: true });
  }

  close(): void {
    this.#database.close();
  }

  getPeriod(periodId: string): Period | undefined {
    const row = this.#database.prepare("SELECT payload_json FROM periods WHERE period_id = ?").get(periodId) as { payload_json: string } | undefined;
    return row ? parseRecord<Period>(row.payload_json) : undefined;
  }

  getChildren(periodId: string): Period[] {
    const rows = this.#database.prepare("SELECT payload_json FROM periods WHERE parent_period_id = ? ORDER BY start_ordinal, period_id").all(periodId) as Array<{ payload_json: string }>;
    return rows.map((row) => parseRecord<Period>(row.payload_json));
  }

  getRootPeriods(): Period[] {
    const rows = this.#database.prepare("SELECT payload_json FROM periods WHERE parent_period_id IS NULL ORDER BY start_ordinal, period_id").all() as Array<{ payload_json: string }>;
    return rows.map((row) => parseRecord<Period>(row.payload_json));
  }

  getRegions(regionIds?: readonly string[]): Region[] {
    if (regionIds && regionIds.length > 0) {
      const statement = this.#database.prepare("SELECT payload_json FROM regions WHERE region_id = ?");
      return regionIds.flatMap((id) => {
        const row = statement.get(id) as { payload_json: string } | undefined;
        return row ? [parseRecord<Region>(row.payload_json)] : [];
      });
    }
    const rows = this.#database.prepare("SELECT payload_json FROM regions ORDER BY name_zh, region_id").all() as Array<{ payload_json: string }>;
    return rows.map((row) => parseRecord<Region>(row.payload_json));
  }

  getEvent(eventId: string): TimelineEvent | undefined {
    const row = this.#database.prepare("SELECT payload_json FROM events WHERE event_id = ?").get(eventId) as { payload_json: string } | undefined;
    return row ? parseRecord<TimelineEvent>(row.payload_json) : undefined;
  }

  getEventPlacements(eventId: string): EventPlacement[] {
    return this.#database.prepare("SELECT placement_id, event_id, line_id, period_id, display_weight, order_index, role FROM placements WHERE event_id = ? ORDER BY order_index, placement_id").all(eventId) as unknown as EventPlacement[];
  }

  getTimelinePlacements(periodId: string, regionIds: readonly string[]): Array<{ placement: EventPlacement; event: TimelineEvent; region: Region }> {
    const statement = this.#database.prepare(`
      SELECT p.placement_id, p.event_id, p.line_id, p.period_id, p.display_weight, p.order_index, p.role,
             e.payload_json AS event_json, r.payload_json AS region_json
      FROM placements p
      JOIN events e ON e.event_id = p.event_id
      JOIN regions r ON r.region_id = p.line_id
      WHERE p.period_id = ?
      ORDER BY e.start_ordinal, p.order_index, p.placement_id
    `);
    const rows = statement.all(periodId) as unknown as PlacementRow[];
    const regionSet = new Set(regionIds);
    return rows.filter((row) => regionSet.size === 0 || regionSet.has(row.line_id)).map((row) => ({
      placement: {
        placement_id: row.placement_id,
        event_id: row.event_id,
        line_id: row.line_id,
        period_id: row.period_id,
        display_weight: row.display_weight,
        order_index: row.order_index,
        role: row.role,
      },
      event: parseRecord<TimelineEvent>(row.event_json),
      region: parseRecord<Region>(row.region_json),
    }));
  }

  search(query: string): TimelineEvent[] {
    if ([...query].length < 3) {
      const rows = this.#database.prepare("SELECT payload_json FROM events WHERE title_zh LIKE ? ORDER BY start_ordinal, event_id LIMIT 50").all(`%${query}%`) as Array<{ payload_json: string }>;
      return rows.map((row) => parseRecord<TimelineEvent>(row.payload_json));
    }
    const rows = this.#database.prepare("SELECT e.payload_json FROM event_search s JOIN events e ON e.event_id = s.event_id WHERE event_search MATCH ? ORDER BY e.start_ordinal, e.event_id LIMIT 50").all(query) as Array<{ payload_json: string }>;
    return rows.map((row) => parseRecord<TimelineEvent>(row.payload_json));
  }
}
