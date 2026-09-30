import { rm } from "node:fs/promises";

await Promise.all([
  rm("dist", { force: true, recursive: true }),
  rm("dist-web", { force: true, recursive: true }),
  rm("tsconfig.server.tsbuildinfo", { force: true }),
  rm("tsconfig.web.tsbuildinfo", { force: true }),
]);
