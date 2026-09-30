import { resolve } from "node:path";
import { readDataset } from "./dataset-files.js";
import { rebuildIndex } from "./sqlite-index.js";

const root = resolve(import.meta.dirname, "../..");
const dataset = readDataset(resolve(root, "data/timeline"));
const indexPath = resolve(root, "data/index/timeline.sqlite");
const counts = rebuildIndex(dataset, indexPath);
console.log(JSON.stringify({ index: indexPath, counts }));
