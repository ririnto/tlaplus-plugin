#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { runTool, toolNames } from "./runner.mts";
import type { ToolInput } from "./runner.mts";

import pkg from "../package.json" with { type: "json" };

const server = new McpServer({ name: "tlaplus-plugin", version: pkg.version });
const fileName = z
  .string()
  .refine((value) => path.isAbsolute(value), "Must be an absolute path");
const tlcSchema = {
  fileName,
  cfgFile: fileName.optional(),
  extraOpts: z.array(z.string()).optional(),
  extraJavaOpts: z.array(z.string()).optional()
};
const descriptions = {
  tlaplus_mcp_sany_parse:
    "Parse and semantically analyze a TLA+ module with SANY.",
  tlaplus_mcp_tlc_check: "Model-check a TLA+ module with TLC.",
  tlaplus_mcp_tlc_smoke:
    "Run one bounded random TLC simulation trace (100 steps by default).",
  tlaplus_mcp_tlc_explore:
    "Return one bounded random TLC behavior with ordered states and variable values, including the initial state."
};
const schemas = {
  tlaplus_mcp_sany_parse: { fileName },
  tlaplus_mcp_tlc_check: tlcSchema,
  tlaplus_mcp_tlc_smoke: tlcSchema,
  tlaplus_mcp_tlc_explore: {
    ...tlcSchema,
    behaviorLength: z.number().int().positive().optional()
  }
};
for (const name of toolNames) {
  const inputSchema = schemas[name];
  server.registerTool(
    name,
    { description: descriptions[name], inputSchema },
    async (
      input: ToolInput,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ): Promise<CallToolResult> => {
      try {
        const result = await runTool(name, input, extra.signal);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: result.failed
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error)
            }
          ],
          isError: true
        };
      }
    }
  );
}
const knowledge = new URL("./knowledgebase/", import.meta.url);
for (const file of await readdir(knowledge, { withFileTypes: true })) {
  if (file.isFile() && file.name.endsWith(".md")) {
    const uri = `tlaplus://knowledge/${file.name}`;
    const source = new URL(file.name, knowledge);
    server.registerResource(file.name, uri, { mimeType: "text/markdown" }, async () => ({
      contents: [{ uri, mimeType: "text/markdown", text: await readFile(source, "utf8") }]
    }));
  }
}

await server.connect(new StdioServerTransport());
