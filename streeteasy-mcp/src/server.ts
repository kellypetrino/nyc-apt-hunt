import express, {
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { buildServer } from "./mcp";
import { StreetEasyAuthProvider } from "./auth";
import { resolveProxyFromEnv, redactProxyUrl } from "./streeteasy/index";

const PORT = Number(process.env.PORT) || 3000;

// OAuth is on by default so MCP clients can connect via the standard
// authorization flow (incl. Dynamic Client Registration). Set MCP_DISABLE_AUTH
// for an open server (e.g. local testing with the bundled test-client).
const AUTH_ENABLED = !/^(1|true|yes)$/i.test(process.env.MCP_DISABLE_AUTH ?? "");

/**
 * Public origin this server is reachable at — used as the OAuth issuer and in
 * the protected-resource metadata. Railway injects RAILWAY_PUBLIC_DOMAIN;
 * PUBLIC_BASE_URL overrides it. Falls back to localhost for local runs.
 */
function resolvePublicBaseUrl(): string {
  const explicit = process.env.PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  return `http://localhost:${PORT}`;
}

const PUBLIC_BASE_URL = resolvePublicBaseUrl();
const provider = new StreetEasyAuthProvider();
const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(
  new URL(PUBLIC_BASE_URL),
);

const app = express();
// Behind Railway's proxy: trust X-Forwarded-* for correct client IPs / scheme
// (rate limiting and OAuth metadata depend on it).
app.set("trust proxy", true);
app.use(express.json({ limit: "4mb" }));

// Permissive CORS so browser-based and remote MCP clients can connect.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  );
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Health checks (Railway + humans hitting the root URL).
app.get("/", (_req, res) => {
  res.json({
    name: "streeteasy-mcp",
    status: "ok",
    transport: "streamable-http",
    endpoint: "/mcp",
    authRequired: AUTH_ENABLED,
    ...(AUTH_ENABLED
      ? {
          authorizationServer: new URL(PUBLIC_BASE_URL).href,
          protectedResourceMetadata: resourceMetadataUrl,
        }
      : {}),
  });
});
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// OAuth 2.1 endpoints: authorization-server + protected-resource metadata,
// Dynamic Client Registration (/register), /authorize, /token, /revoke.
if (AUTH_ENABLED) {
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(PUBLIC_BASE_URL),
      scopesSupported: ["mcp"],
      resourceName: "StreetEasy MCP",
    }),
  );
}

// Require a valid bearer token on /mcp (unless auth is disabled). Unauthenticated
// requests get a 401 with a WWW-Authenticate header pointing at the
// protected-resource metadata, which kicks off discovery + DCR on the client.
const mcpAuth: RequestHandler[] = AUTH_ENABLED
  ? [requireBearerAuth({ verifier: provider, resourceMetadataUrl })]
  : [];

// Stateless Streamable HTTP: build a fresh server + transport per request.
app.post("/mcp", ...mcpAuth, async (req: Request, res: Response) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless mode does not support server-initiated GET/DELETE sessions.
const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (stateless server)." },
    id: null,
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => {
  console.log(`streeteasy-mcp listening on :${PORT} (POST /mcp)`);
  console.log(
    AUTH_ENABLED
      ? `OAuth enabled — issuer ${PUBLIC_BASE_URL} (DCR at /register)`
      : "OAuth DISABLED (MCP_DISABLE_AUTH set) — /mcp is open.",
  );
  const proxy = resolveProxyFromEnv();
  // StreetEasy blocks datacenter IPs, so a residential proxy is required for
  // this hosted deployment to reach the API. Surface it for operators.
  if (proxy) {
    console.log(`Outbound proxy: ${redactProxyUrl(proxy)}`);
  } else {
    console.warn(
      "No outbound proxy configured (direct). StreetEasy blocks datacenter " +
        "IPs, so API calls from cloud hosts will likely fail. Set STREETEASY_PROXY.",
    );
  }
});
