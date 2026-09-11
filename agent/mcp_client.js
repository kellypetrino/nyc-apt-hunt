import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const STDIO_ENTRY = fileURLToPath(
  new URL("../streeteasy-mcp/dist/stdio.js", import.meta.url)
);

export async function withMcpClient(fn) {
  const transport = new StdioClientTransport({
    // Use the exact node binary running this process (process.execPath),
    // not the bare "node" command — launchd runs with a minimal PATH
    // (/usr/bin:/bin:/usr/sbin:/sbin) that doesn't include nvm's node,
    // so spawning by name alone fails with ENOENT under the schedule.
    command: process.execPath,
    args: [STDIO_ENTRY],
  });
  const client = new Client({ name: "nyc-apt-hunt-agent", version: "1.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries on StreetEasy's PerimeterX 403 bot-challenge with backoff. Without a
 * residential proxy, a 403 usually means this IP is temporarily flagged, so
 * retries are a token effort — the real recovery is the next scheduled run,
 * hours later, once the flag clears.
 */
export async function callTool(client, name, args, { retries = 1, backoffMs = 8000 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const result = await client.callTool({ name, arguments: args });
    if (!result.isError) return JSON.parse(result.content[0].text);

    const message = result.content?.[0]?.text ?? "unknown error";
    const isBotChallenge = /403/.test(message);
    if (!isBotChallenge || attempt >= retries) {
      throw new Error(`MCP tool ${name} failed: ${message}`);
    }
    await sleep(backoffMs * (attempt + 1));
  }
}
