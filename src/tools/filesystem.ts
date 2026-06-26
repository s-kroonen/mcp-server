import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Folders the MCP server is allowed to access — set via env as comma-separated paths
const allowedRoots = (): string[] =>
  (process.env.NAS_ALLOWED_PATHS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

function assertAllowed(target: string) {
  const resolved = path.resolve(target);
  const roots = allowedRoots();
  if (roots.length === 0) throw new Error("NAS_ALLOWED_PATHS is not configured.");
  if (!roots.some((r) => resolved.startsWith(path.resolve(r)))) {
    throw new Error(`Access denied: '${resolved}' is outside allowed paths.`);
  }
  return resolved;
}

async function walkDir(
  dir: string,
  pattern: RegExp,
  results: string[],
  maxDepth: number,
  depth = 0
) {
  if (depth > maxDepth) return;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, pattern, results, maxDepth, depth + 1);
    } else if (pattern.test(entry.name)) {
      results.push(full);
    }
  }
}

export function registerFilesystemTools(server: McpServer) {
  server.registerTool(
    "list_files",
    {
      title: "List Files",
      description: "List files and folders in a directory on the NAS.",
      inputSchema: {
        dir: z.string().describe("Absolute path to list (must be within an allowed NAS path)"),
      },
    },
    async ({ dir }) => {
      const resolved = assertAllowed(dir);
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const lines = entries.map(
        (e) => `${e.isDirectory() ? "[DIR] " : "[FILE]"} ${e.name}`
      );
      return {
        content: [{ type: "text" as const, text: lines.join("\n") || "(empty)" }],
      };
    }
  );

  server.registerTool(
    "read_file",
    {
      title: "Read File",
      description: "Read the text content of a file on the NAS (max 500 KB).",
      inputSchema: {
        file: z.string().describe("Absolute path to the file"),
      },
    },
    async ({ file }) => {
      const resolved = assertAllowed(file);
      const stat = await fs.stat(resolved);
      if (stat.size > 500_000) throw new Error("File too large (max 500 KB).");
      const content = await fs.readFile(resolved, "utf-8");
      return { content: [{ type: "text" as const, text: content }] };
    }
  );

  server.registerTool(
    "search_files",
    {
      title: "Search Files",
      description:
        "Recursively search for files by name pattern within an allowed NAS path.",
      inputSchema: {
        root: z
          .string()
          .describe("Root directory to search from (must be within an allowed NAS path)"),
        pattern: z
          .string()
          .describe("Regex or plain string to match against file names (case-insensitive)"),
        maxDepth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Maximum folder depth to recurse (default 5)"),
      },
    },
    async ({ root, pattern, maxDepth }) => {
      const resolved = assertAllowed(root);
      const regex = new RegExp(pattern, "i");
      const results: string[] = [];
      await walkDir(resolved, regex, results, maxDepth);
      const text =
        results.length > 0
          ? results.join("\n")
          : `Geen bestanden gevonden die overeenkomen met '${pattern}'.`;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.registerTool(
    "allowed_paths",
    {
      title: "List Allowed Paths",
      description: "Show which NAS paths this MCP server has access to.",
      inputSchema: {},
    },
    async () => {
      const roots = allowedRoots();
      return {
        content: [
          {
            type: "text" as const,
            text:
              roots.length > 0
                ? "Toegestane paden:\n" + roots.join("\n")
                : "Geen paden geconfigureerd (NAS_ALLOWED_PATHS is leeg).",
          },
        ],
      };
    }
  );
}
