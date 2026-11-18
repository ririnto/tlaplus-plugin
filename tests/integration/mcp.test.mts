import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

import { simulationDepth } from "../simulation-output.mts";

const successfulExecution = (result: unknown) => {
  const response = z
    .object({
      isError: z.boolean().optional(),
      content: z.tuple([
        z.object({ type: z.literal("text"), text: z.string() })
      ])
    })
    .parse(result);
  assert.notEqual(response.isError, true, JSON.stringify(result));
  return z
    .object({
      exitCode: z.literal(0),
      signal: z.null(),
      failed: z.literal(false),
      truncated: z.literal(false),
      stdout: z.string(),
      stderr: z.string()
    })
    .parse(JSON.parse(response.content[0].text));
};

const root = new URL("../../", import.meta.url);
const fileName = fileURLToPath(new URL("examples/Counter.tla", root));
const cfgFile = fileURLToPath(new URL("examples/Counter.cfg", root));
await test("all four MCP tools execute the real jar, with positive and negative SANY", async () => {
  const client = new Client({ name: "tlaplus-integration", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: [fileURLToPath(new URL("dist/server.mjs", root))]
  });
  try {
    await client.connect(transport);
    const article = "tlc-config-files.md";
    const uri = `tlaplus://knowledge/${article}`;
    const catalog = await client.listResources();
    assert.ok(catalog.resources.some(resource => resource.uri === uri));
    const { contents } = await client.readResource({ uri });
    assert.deepEqual(contents, [{
      uri,
      mimeType: "text/markdown",
      text: await readFile(new URL(`dist/knowledgebase/${article}`, root), "utf8")
    }]);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 4);
    const cases = [
      {
        name: "tlaplus_mcp_sany_parse",
        args: { fileName },
        expected: /Semantic processing of module Counter/u
      },
      {
        name: "tlaplus_mcp_tlc_check",
        args: { fileName, cfgFile },
        expected: /states generated/u
      },
      {
        name: "tlaplus_mcp_tlc_smoke",
        args: { fileName, cfgFile },
        expected: /Running Random Simulation/u
      },
      {
        name: "tlaplus_mcp_tlc_explore",
        args: { fileName, cfgFile, behaviorLength: 5 },
        expected: /Running Random Simulation/u
      }
    ];
    await Promise.all(
      cases.map(async ({ name, args, expected }) => {
        const result = await client.callTool({ name, arguments: args });
        const execution = successfulExecution(result);
        assert.match(execution.stdout, expected);
      })
    );
    const probe = {
      fileName: fileURLToPath(new URL("tests/fixtures/DepthProbe.tla", root)),
      cfgFile: fileURLToPath(new URL("tests/fixtures/DepthProbe.cfg", root))
    };
    const [shortDepth, longDepth] = await Promise.all(
      [3, 7].map(async (behaviorLength) => {
        const result = await client.callTool({
          name: "tlaplus_mcp_tlc_explore",
          arguments: { ...probe, behaviorLength }
        });
        return simulationDepth(successfulExecution(result).stdout);
      })
    );
    assert.equal(
      longDepth - shortDepth,
      4,
      "Requested depth must change the executed behavior length"
    );
    const smoke = await client.callTool({
      name: "tlaplus_mcp_tlc_smoke",
      arguments: probe
    });
    assert.ok(simulationDepth(successfulExecution(smoke).stdout) > 0);
    const broken = await client.callTool({
      name: "tlaplus_mcp_sany_parse",
      arguments: {
        fileName: fileURLToPath(new URL("examples/Broken.tla", root))
      }
    });
    assert.equal(broken.isError, true, JSON.stringify(broken));
  } finally {
    await client.close();
  }
});
