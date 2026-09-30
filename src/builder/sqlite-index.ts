import { existsSync, renameSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { TimelineDataset } from "../shared/timeline.js";
import { ensureParentDirectory } from "./dataset-files.js";

export interface IndexCounts {
  regions: number;
  periods: number;
  events: number;
  placements: number;
}

function ordinalStart(span: TimelineDataset["events"][number]["time_span"]): number {
  return span.kind === "point" ? span.at.year_ordinal : span.start.year_ordinal;
}

function createIndexFile(dataset: TimelineDataset, path: string): IndexCounts {
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA foreign_keys = ON;
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE regions (region_id TEXT PRIMARY KEY, name_zh TEXT NOT NULL, region_type TEXT NOT NULL, parent_id TEXT, payload_json TEXT NOT NULL);
      CREATE TABLE periods (period_id TEXT PRIMARY KEY, parent_period_id TEXT, title_zh TEXT NOT NULL, start_ordinal INTEGER NOT NULL, end_ordinal INTEGER NOT NULL, scale TEXT NOT NULL, expandable INTEGER NOT NULL, coverage_status TEXT NOT NULL, payload_json TEXT NOT NULL);
      CREATE TABLE events (event_id TEXT PRIMARY KEY, title_zh TEXT NOT NULL, event_kind TEXT NOT NULL, start_ordinal INTEGER NOT NULL, data_status TEXT NOT NULL, payload_json TEXT NOT NULL);
      CREATE TABLE placements (placement_id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(event_id), line_id TEXT NOT NULL REFERENCES regions(region_id), period_id TEXT NOT NULL REFERENCES periods(period_id), display_weight TEXT NOT NULL, order_index INTEGER NOT NULL, role TEXT NOT NULL, UNIQUE(event_id, line_id, period_id));
      CREATE VIRTUAL TABLE event_search USING fts5(event_id UNINDEXED, title_zh, tokenize='trigram');
    `);
    database.exec("BEGIN IMMEDIATE");
    const insertRegion = database.prepare("INSERT INTO regions VALUES (?, ?, ?, ?, ?)");
    for (const item of dataset.regions) insertRegion.run(item.region_id, item.name_zh, item.region_type, item.parent_id ?? null, JSON.stringify(item));
    const insertPeriod = database.prepare("INSERT INTO periods VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const item of dataset.periods) {
      if (item.time_span.kind !== "range") throw new Error(`Period ${item.period_id} is not a range`);
      insertPeriod.run(item.period_id, item.parent_period_id ?? null, item.title_zh, item.time_span.start.year_ordinal, item.time_span.end_exclusive.year_ordinal, item.scale, item.expandable ? 1 : 0, item.coverage_status, JSON.stringify(item));
    }
    const insertEvent = database.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?)");
    const insertSearch = database.prepare("INSERT INTO event_search VALUES (?, ?)");
    for (const item of dataset.events) {
      insertEvent.run(item.event_id, item.title_zh, item.event_kind, ordinalStart(item.time_span), item.data_status, JSON.stringify(item));
      insertSearch.run(item.event_id, item.title_zh);
    }
    const insertPlacement = database.prepare("INSERT INTO placements VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const item of dataset.placements) insertPlacement.run(item.placement_id, item.event_id, item.line_id, item.period_id, item.display_weight, item.order_index, item.role);
    database.prepare("INSERT INTO metadata VALUES (?, ?)").run("schema_version", dataset.schema_version);
    database.exec("COMMIT");
    database.exec("PRAGMA optimize");
    const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (integrity.integrity_check !== "ok") throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);
    return readIndexCounts(database);
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* No active transaction. */ }
    throw error;
  } finally {
    database.close();
  }
}

export function readIndexCounts(database: DatabaseSync): IndexCounts {
  const count = (table: string): number => (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
  return { regions: count("regions"), periods: count("periods"), events: count("events"), placements: count("placements") };
}

export function rebuildIndex(dataset: TimelineDataset, targetPath: string): IndexCounts {
  ensureParentDirectory(targetPath);
  const temporaryPath = `${targetPath}.${process.pid}-${Date.now()}.tmp`;
  const backupPath = `${targetPath}.previous`;
  rmSync(temporaryPath, { force: true });
  rmSync(backupPath, { force: true });
  try {
    const counts = createIndexFile(dataset, temporaryPath);
    if (existsSync(targetPath)) renameSync(targetPath, backupPath);
    try {
      renameSync(temporaryPath, targetPath);
      rmSync(backupPath, { force: true });
    } catch (error) {
      if (existsSync(backupPath)) renameSync(backupPath, targetPath);
      throw error;
    }
    return counts;
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
