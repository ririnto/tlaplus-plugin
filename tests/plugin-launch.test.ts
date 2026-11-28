import assert from "node:assert/strict";
import type { SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { sync } from "cross-spawn";

import { readManifest } from "../scripts/manifest.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
await Promise.all(
  ["claude", "codex", "cursor"].map(async (editor) => {
    await test(`${editor} prefers the installed MCP command`, async (context) => {
      const { mcpServers: source } = await readManifest(
        path.join(root, `.${editor}-plugin/plugin.json`)
      );
      const { mcpServers: servers } =
        typeof source === "string"
          ? await readManifest(path.resolve(root, source))
          : { mcpServers: source };
      assert.ok(
        typeof servers === "object" && servers !== null && "tlaplus" in servers
      );
      const server = servers.tlaplus;
      assert.ok(typeof server === "object" && server !== null);
      assert.ok("command" in server && typeof server.command === "string");
      assert.ok("args" in server && Array.isArray(server.args));
      const args: unknown[] = server.args;
      assert.ok(args.every((arg) => typeof arg === "string"));

      const cwd = mkdtempSync(path.join(tmpdir(), "tlaplus editor "));
      context.after(() => {
        rmSync(cwd, { force: true, recursive: true });
      });
      const fixture = path.join(cwd, "probe.cjs");
      writeFileSync(
        fixture,
        "const fs = require('node:fs');\n" +
          "if (fs.realpathSync(process.cwd()) !== __dirname) process.exit(91);\n" +
          "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n" +
          "process.stdout.write(fs.readFileSync(0));\n" +
          "process.stderr.write('fixture stderr\\n');\n" +
          "process.exitCode = 23;\n"
      );

      for (const name of ["npx", "tlaplus-mcp"]) {
        const windows = process.platform === "win32";
        writeFileSync(
          path.join(cwd, windows ? `${name}.cmd` : name),
          windows
            ? `@"${process.execPath}" "${fixture}" ${name} %*\r\n`
            : `#!/bin/sh\nexec "${process.execPath}" "${fixture}" ${name} "$@"\n`,
          { mode: 0o755 }
        );
        const result: SpawnSyncReturns<string> = sync(
          server.command === "node" ? process.execPath : server.command,
          args,
          {
            cwd,
            encoding: "utf-8",
            env: { ...process.env, PATH: cwd },
            input: "MCP stdin\n",
            timeout: 5000
          }
        );
        assert.equal(result.status, 23, result.stderr);
        assert.equal(result.stderr, "fixture stderr\n");
        assert.equal(
          result.stdout,
          `${JSON.stringify(name === "npx" ? ["npx", "-y", "@tlaplus-mcp/tlaplus-mcp"] : [name])}\nMCP stdin\n`
        );
      }
    });
  })
);
