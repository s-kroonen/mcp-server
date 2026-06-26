import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerEmailTools } from "./tools/email.js";

const server = new McpServer({ name: "storm-mcp", version: "1.0.0" });
registerEmailTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
