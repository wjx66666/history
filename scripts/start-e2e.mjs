process.env.NODE_ENV = "production";
process.env.PORT = "4185";

await import("../dist/server/index.js");
