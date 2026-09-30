import { readFileSync } from "node:fs";

export function parseJsonLines<T>(content: string, sourceName: string): T[] {
  const records: T[] = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line) as T);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new SyntaxError(`${sourceName}:${index + 1}: invalid JSON: ${detail}`);
    }
  }
  return records;
}

export function readJsonLines<T>(path: string): T[] {
  return parseJsonLines<T>(readFileSync(path, "utf8"), path);
}

export function serializeJsonLines(records: readonly unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
}
