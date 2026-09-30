import { spawn } from "node:child_process";

const port = 4183;
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["scripts/start-production.mjs"], {
  env: { ...process.env, NODE_ENV: "", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

async function waitForService() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response;
    } catch {
      // The process may still be binding the loopback socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Production service did not become ready.\n${output}`);
}

try {
  const healthResponse = await waitForService();
  const health = await healthResponse.json();
  if (health.status !== "ok") throw new Error("Health response was not ok.");

  for (const path of ["/", "/period/example"]) {
    const response = await fetch(`${baseUrl}${path}`);
    const body = await response.text();
    if (!response.ok || !body.includes('<div id="root"></div>')) {
      throw new Error(`SPA response failed for ${path}.`);
    }
  }

  const html = await (await fetch(baseUrl)).text();
  for (const [asset, contentType] of [[html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1], "javascript"], [html.match(/href="(\/assets\/[^\"]+\.css)"/)?.[1], "text/css"]]) {
    if (!asset) throw new Error("Production HTML is missing a bundled asset.");
    const response = await fetch(`${baseUrl}${asset}`);
    if (!response.ok || !response.headers.get("content-type")?.includes(contentType)) {
      throw new Error(`Bundled asset failed: ${asset} (${response.status}, ${response.headers.get("content-type")}).`);
    }
  }

  console.log(`Production smoke passed at ${baseUrl}.`);
} finally {
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", resolve);
  });
}
