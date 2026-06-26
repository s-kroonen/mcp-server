import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { registerEmailTools } from "./tools/email.js";

const PORT = Number(process.env.PORT ?? 3000);
const API_KEY = process.env.MCP_API_KEY;

if (!API_KEY) {
  console.error("MCP_API_KEY is not set — refusing to start without auth.");
  process.exit(1);
}

function createMcpServer() {
  const s = new McpServer({ name: "storm-mcp", version: "1.0.0" });
  registerEmailTools(s);
  return s;
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Health check is unauthenticated so Docker/Portainer can probe it
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "storm-mcp" }));
    return;
  }

  // All other routes require the API key
  const authHeader = req.headers["x-api-key"];
  if (authHeader !== API_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  if (req.url === "/mcp") {
    // Create a fresh server+transport per request (stateless MCP over HTTP)
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end();
});

httpServer.listen(PORT, () => {
  console.log(`storm-mcp running on port ${PORT}`);
  console.log(`Endpoint: http://0.0.0.0:${PORT}/mcp`);
});
