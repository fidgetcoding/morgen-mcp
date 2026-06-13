#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { spawnSync } from "node:child_process";

// Load .env from repo root
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = process.env.DOTENV_CONFIG_PATH || resolve(__dirname, "../.env");
// quiet: dotenv >= 17 prints an "injected env" tip line to STDOUT by default.
// Stdout is the MCP JSON-RPC channel — any non-JSON line corrupts the stream.
config({ path: ENV_PATH, quiet: true });

// Read version from package.json so it never drifts from the published release
const PKG = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));

// Setup dispatch — must run BEFORE the env-var check below, otherwise the
// documented "npx fidgetcoding-morgen-mcp setup" command dies on the very
// missing key it exists to create. The wizard runs in a child process with
// inherited stdio (it's interactive); setup.js is fire-and-forget async, so
// an in-process import would race the exit below.
if (process.argv[2] === "setup") {
  const { status } = spawnSync(
    process.execPath,
    [resolve(__dirname, "../bin/setup.js")],
    { stdio: "inherit" }
  );
  process.exit(status ?? 0);
}

// Startup validation
if (!process.env.MORGEN_API_KEY) {
  console.error(
    "Missing required environment variable: MORGEN_API_KEY\n" +
    "Run \"npx fidgetcoding-morgen-mcp setup\" or see .env.example for details."
  );
  process.exit(1);
}

// Import tool definitions and handlers from sibling modules
import { EVENT_TOOLS, eventHandlers } from "./tools-events.js";
import { TASK_TOOLS, taskHandlers } from "./tools-tasks.js";
import { REFLOW_TOOLS, reflowHandlers } from "./tools-reflow.js";
import { CONVERSION_TOOLS, conversionHandlers } from "./tools-conversions.js";

const TOOLS = [
  ...EVENT_TOOLS,
  ...TASK_TOOLS,
  ...REFLOW_TOOLS,
  ...CONVERSION_TOOLS,
];
const HANDLERS = {
  ...eventHandlers,
  ...taskHandlers,
  ...reflowHandlers,
  ...conversionHandlers,
};

// Server setup
const server = new Server(
  { name: "morgen", version: PKG.version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  try {
    const handler = HANDLERS[name];
    if (!handler) {
      return {
        content: [{ type: "text", text: "Unknown tool" }],
        isError: true,
      };
    }

    const result = await handler(args || {});

    console.error(JSON.stringify({
      event: "tool_call",
      tool: name,
      status: "success",
      durationMs: Date.now() - startTime,
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    // Sanitize error: strip URLs so API endpoints/keys don't leak, and
    // fall back to a generic message for unexpected (non-Error) throws.
    const URL_REDACT = /https?:\/\/[^\s)]+/g;
    const safeMessage = (error instanceof Error && error.message)
      ? error.message.replace(URL_REDACT, "[redacted-url]")
      : "An unexpected error occurred";

    // v0.1.6: partial-failure metadata attached by handlers (reflow_day's
    // err.reflow = { applied, pending, ... } and event_to_task's
    // err.conversion = { task_id, ... }) was being silently stripped by the
    // top-level catch. Surface it on both the stderr log and the tool
    // response so callers can recover without re-running a dry_run.
    const structuredMeta = {};
    if (error && typeof error === "object") {
      if (error.reflow) structuredMeta.reflow = error.reflow;
      if (error.conversion) structuredMeta.conversion = error.conversion;
    }
    const hasMeta = Object.keys(structuredMeta).length > 0;
    // Re-use the URL scrubber on the serialized metadata so nested
    // error_message fields can't leak endpoints either.
    const metaJson = hasMeta
      ? JSON.stringify(structuredMeta, null, 2).replace(URL_REDACT, "[redacted-url]")
      : null;

    console.error(JSON.stringify({
      event: "tool_call",
      tool: name,
      status: "error",
      durationMs: Date.now() - startTime,
      error: safeMessage,
      ...(hasMeta ? { metadata: structuredMeta } : {}),
    }));

    return {
      content: [{
        type: "text",
        text: hasMeta
          ? `Error: ${safeMessage}\n\nPartial state metadata:\n${metaJson}`
          : `Error: ${safeMessage}`,
      }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(
    "[morgen-mcp] Fatal startup error:",
    err instanceof Error ? err.message : "Unknown error"
  );
  process.exit(1);
});
