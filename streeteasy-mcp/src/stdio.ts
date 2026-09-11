import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./mcp";
import { resolveProxyFromEnv, redactProxyUrl } from "./streeteasy/index";

/**
 * Local stdio entry point. Run this from a residential IP (e.g. your machine)
 * and register it with an MCP client like Claude Code:
 *
 *   claude mcp add streeteasy -- node /abs/path/to/dist/stdio.js
 *
 * StreetEasy's API is behind PerimeterX bot-detection that blocks cloud/
 * datacenter IPs, so the HTTP deployment can't reach it — but a local stdio
 * server running from a normal residential connection works.
 *
 * NOTE: never write to stdout here — stdout is the JSON-RPC channel. Use
 * stderr for diagnostics.
 */
async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const proxy = resolveProxyFromEnv();
  process.stderr.write(
    `streeteasy-mcp (stdio) ready${
      proxy ? ` — proxy: ${redactProxyUrl(proxy)}` : " — direct (no proxy)"
    }\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`streeteasy-mcp failed to start: ${String(err)}\n`);
  process.exit(1);
});
