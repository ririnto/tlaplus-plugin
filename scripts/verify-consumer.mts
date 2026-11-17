import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

import { run } from "./command.mts";

const root = new URL("../", import.meta.url);
const metadata = z
  .object({ version: z.string() })
  .parse(JSON.parse(await readFile(new URL("package.json", root), "utf-8")));
const tarball = fileURLToPath(
  new URL(`ririnto-tlaplus-plugin-${metadata.version}.tgz`, root)
);
const directory = await mkdtemp(path.join(tmpdir(), "tlaplus-consumer-"));
const client = new Client({ name: "clean-consumer", version: "1.0.0" });
try {
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "tlaplus-consumer-test",
      version: "1.0.0",
      private: true
    })
  );
  await run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      tarball
    ],
    { cwd: directory }
  );
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: [
        path.join(
          directory,
          "node_modules/@ririnto/tlaplus-plugin/dist/server.mjs"
        )
      ],
      cwd: directory
    })
  );
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 4);
  const result = await client.callTool({
    name: "tlaplus_mcp_sany_parse",
    arguments: {
      fileName: fileURLToPath(new URL("examples/Counter.tla", root))
    }
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  process.stdout.write(
    "Clean npm tarball install, MCP initialization, four tools and SANY passed.\n"
  );
} finally {
  await client.close();
  await rm(directory, { recursive: true, force: true });
}
