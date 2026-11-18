import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

const responseSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() }))
});
const executionSchema = z.object({
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  failed: z.boolean(),
  truncated: z.boolean(),
  behavior: z.string().optional(),
  behaviorError: z.string().optional()
});

await test("ordinary specs return ordered behaviors through stdio without hiding failures", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "explore-mcp-"));
  const runtime = path.join(directory, "runtime");
  await mkdir(runtime);
  const requestDirectories = async () =>
    (await readdir(runtime)).filter(name => name.startsWith("tlaplus-plugin-"));
  const fileName = path.join(directory, "Finite.tla");
  const cfgFile = path.join(directory, "Finite.cfg");
  const badConfig = path.join(directory, "Bad.cfg");
  await writeFile(
    fileName,
    `---- MODULE Finite ----
EXTENDS Naturals
VARIABLE x
Init == x = 0
Next == x' = (x + 1) % 3
NeverTwo == x # 2
====
`
  );
  await writeFile(cfgFile, "INIT Init\nNEXT Next\n");
  await writeFile(badConfig, "INIT Init\nNEXT Next\nINVARIANT NeverTwo\n");
  const client = new Client({
    name: "ordinary-behavior-test",
    version: "1.0.0"
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../../dist/server.mjs", import.meta.url))],
    env: { ...getDefaultEnvironment(), TMPDIR: runtime, TEMP: runtime, TMP: runtime }
  });
  try {
    await client.connect(transport);
    const verifyDepth = async (behaviorLength: number) => {
      const result = responseSchema.parse(
        await client.callTool({
          name: "tlaplus_mcp_tlc_explore",
          arguments: { fileName, cfgFile, behaviorLength }
        })
      );
      assert.equal(result.isError, false);
      const execution = executionSchema.parse(
        JSON.parse(result.content[0].text)
      );
      assert.equal(execution.exitCode, 0);
      assert.equal(execution.failed, false);
      assert.equal(execution.truncated, false);
      assert.equal(execution.signal, null);
      assert.ok(typeof execution.behavior === "string");
      assert.notEqual(execution.behavior, undefined);
      const states = [
        ...execution.behavior.matchAll(/^STATE_(?<number>\d+) == /gmu)
      ].map((match) => Number(match.groups?.number));
      assert.deepEqual(
        states,
        Array.from({ length: behaviorLength }, (_, index) => index + 1)
      );
      const values = [
        ...execution.behavior.matchAll(/^x = (?<value>\d+)$/gmu)
      ].map((match) => Number(match.groups?.value));
      assert.deepEqual(
        values,
        Array.from({ length: behaviorLength }, (_, index) => index % 3)
      );
      assert.deepEqual(await requestDirectories(), []);
    };
    await verifyDepth(3);
    await verifyDepth(7);
    const failure = responseSchema.parse(
      await client.callTool({
        name: "tlaplus_mcp_tlc_explore",
        arguments: { fileName, cfgFile: badConfig, behaviorLength: 7 }
      })
    );
    const execution = executionSchema.parse(
      JSON.parse(failure.content[0].text)
    );
    assert.equal(failure.isError, true);
    assert.equal(execution.failed, true);
    assert.notEqual(execution.exitCode, 0);
    assert.match(execution.stdout, /Invariant NeverTwo is violated/u);
    assert.equal(execution.behavior, undefined);
    assert.deepEqual(await requestDirectories(), []);
    const largeFile = path.join(directory, "Large.tla");
    const largeConfig = path.join(directory, "Large.cfg");
    const largeSource = `---- MODULE Large ----
EXTENDS TLC
VARIABLE x
Init == x = "${"a".repeat(2_100_000)}"
Next == UNCHANGED x
====
`;
    await writeFile(largeFile, largeSource);
    await writeFile(largeConfig, "INIT Init\nNEXT Next\n");
    const verifyLimit = async (expected: RegExp, truncated: boolean) => {
      const result = responseSchema.parse(
        await client.callTool({
          name: "tlaplus_mcp_tlc_explore",
          arguments: {
            fileName: largeFile,
            cfgFile: largeConfig,
            behaviorLength: 1
          }
        })
      );
      const limited = executionSchema.parse(JSON.parse(result.content[0].text));
      assert.equal(result.isError, true);
      assert.equal(limited.exitCode, 0);
      assert.equal(limited.failed, true);
      assert.equal(limited.truncated, truncated);
      assert.equal(limited.behavior, undefined);
      assert.match(limited.behaviorError ?? "", expected);
      assert.deepEqual(await requestDirectories(), []);
    };
    await verifyLimit(/2 MiB/u, false);
    await writeFile(
      largeFile,
      largeSource.replace(
        "Next == UNCHANGED x",
        "Next == PrintT(x) /\\ UNCHANGED x"
      )
    );
    await verifyLimit(/output exceeds/u, true);
    const controller = new AbortController();
    const waitForJava = async (attempt: number): Promise<void> => {
      const directories = await requestDirectories();
      const entries = await Promise.all(
        directories.map(
          async (directoryName) =>
            await readdir(path.join(runtime, directoryName))
        )
      );
      if (!entries.flat().includes("Naturals.tla")) {
        assert.ok(
          attempt < 500,
          "Java must extract a module before cancellation"
        );
        await setTimeout(20);
        await waitForJava(attempt + 1);
      }
    };
    const cancelAfterStart = async () => {
      try {
        await waitForJava(0);
      } finally {
        controller.abort();
      }
    };
    await Promise.all([
      assert.rejects(
        client.callTool(
          {
            name: "tlaplus_mcp_tlc_explore",
            arguments: { fileName, cfgFile, behaviorLength: 1_000_000 }
          },
          undefined,
          { signal: controller.signal }
        )
      ),
      cancelAfterStart()
    ]);
    const waitForCleanup = async (attempt: number): Promise<void> => {
      const entries = await requestDirectories();
      if (attempt < 100 && entries.length > 0) {
        await setTimeout(50);
        await waitForCleanup(attempt + 1);
      }
    };
    await waitForCleanup(0);
    assert.deepEqual(await requestDirectories(), []);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
