import { createApp } from "./app.js";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "4173", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("PORT must be an integer between 1 and 65535.");
  process.exit(1);
}

const app = await createApp({ serveWeb: process.env.NODE_ENV === "production" });

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error, `Unable to start on http://${host}:${port}. Check whether the port is already in use.`);
  process.exit(1);
}
