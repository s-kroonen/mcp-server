import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { checkResourceAllowed } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import { registerEmailTools } from "./tools/email.js";

const PORT = Number(process.env.PORT || 3000);
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// Keycloak auth server config
const AUTH_BASE = process.env.KEYCLOAK_URL ?? "http://keycloak:8080";
const AUTH_REALM = process.env.KEYCLOAK_REALM ?? "storm";
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID!;
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET!;

if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
  console.error("OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET must be set.");
  process.exit(1);
}

const realmBase = `${AUTH_BASE}/realms/${AUTH_REALM}/`;

const oauthMetadata: OAuthMetadata = {
  issuer: realmBase,
  authorization_endpoint: `${realmBase}protocol/openid-connect/auth`,
  token_endpoint: `${realmBase}protocol/openid-connect/token`,
  registration_endpoint: `${realmBase}clients-registrations/openid-connect`,
  introspection_endpoint: `${realmBase}protocol/openid-connect/token/introspect`,
  response_types_supported: ["code"],
};

const mcpServerUrl = new URL(SERVER_URL);

const tokenVerifier = {
  verifyAccessToken: async (token: string) => {
    const params = new URLSearchParams({
      token,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
    });

    const response = await fetch(oauthMetadata.introspection_endpoint!, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Token introspection failed: ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;

    if (!data.active) throw new Error("Token is inactive");

    // Validate audience matches this server
    const audiences = Array.isArray(data.aud) ? data.aud as string[] : [data.aud as string];
    const allowed = audiences.some((a) =>
      checkResourceAllowed({ requestedResource: a, configuredResource: mcpServerUrl })
    );
    if (!allowed) throw new Error(`Token audience mismatch: ${audiences.join(", ")}`);

    return {
      token,
      clientId: data.client_id as string,
      scopes: typeof data.scope === "string" ? data.scope.split(" ") : [],
      expiresAt: data.exp as number,
    };
  },
};

const transports = new Map<string, StreamableHTTPServerTransport>();

function createMcpServer() {
  const s = new McpServer({ name: "storm-mcp", version: "1.0.0" });
  registerEmailTools(s);
  return s;
}

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", exposedHeaders: ["Mcp-Session-Id"] }));

// Health check — unauthenticated
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "storm-mcp" });
});

// OAuth Protected Resource Metadata — unauthenticated, required by MCP spec
app.use(
  mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: mcpServerUrl,
    scopesSupported: ["mcp:tools"],
    resourceName: "Storm MCP Server",
  })
);

const authMiddleware = requireBearerAuth({
  verifier: tokenVerifier,
  requiredScopes: ["mcp:tools"],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
});

// MCP endpoint
app.post("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId)!;
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { transports.set(id, transport); },
    });
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    await createMcpServer().connect(transport);
  } else {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request" }, id: null });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) { res.status(400).send("Invalid session"); return; }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) { res.status(400).send("Invalid session"); return; }
  await transport.handleRequest(req, res);
});

app.listen(PORT, () => {
  console.log(`storm-mcp running on port ${PORT}`);
  console.log(`OAuth metadata: ${getOAuthProtectedResourceMetadataUrl(mcpServerUrl)}`);
});
