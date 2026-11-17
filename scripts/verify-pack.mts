import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { run } from "./command.mts";

const root = new URL("../", import.meta.url);
const metadata = z
  .object({ version: z.string() })
  .parse(JSON.parse(await readFile(new URL("package.json", root), "utf-8")));
const tarball = new URL(`ririnto-tlaplus-plugin-${metadata.version}.tgz`, root);
await run("pnpm", ["pack", "--pack-destination", "."], { cwd: root });
const manifestResult = await run("tar", [
  "-xOf",
  fileURLToPath(tarball),
  "package/package.json"
]);
const manifest = z
  .object({
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional()
  })
  .parse(JSON.parse(manifestResult.stdout));
for (const group of [manifest.dependencies, manifest.devDependencies]) {
  for (const specifier of Object.values(group ?? {})) {
    assert.doesNotMatch(specifier, /^(?:catalog|workspace):/u);
  }
}
const { stdout } = await run(
  "npm",
  ["pack", fileURLToPath(tarball), "--dry-run", "--json"],
  { cwd: root }
);
const packs = z
  .array(z.object({ files: z.array(z.object({ path: z.string() })) }))
  .length(1)
  .parse(JSON.parse(stdout));
assert.equal(packs.length, 1);
const paths = new Set(packs[0].files.map((file) => file.path));
for (const path of [
  "dist/server.mjs",
  "dist/runner.mjs",
  "vendor/tla2tools.jar",
  "vendor/LICENSE",
  ".claude-plugin/plugin.json",
  "LICENSE",
  "README.md",
  "package.json"
]) {
  assert.ok(paths.has(path), `Missing package file: ${path}`);
}
for (const skill of [
  "tlaplus-add-variable",
  "tlaplus-split-action",
  "tlaplus-from-source"
]) {
  assert.ok(paths.has(`skills/${skill}/SKILL.md`));
  assert.ok(paths.has(`skills/${skill}/LICENSE`));
}
assert.equal(
  [...paths].some(
    (path) =>
      path.startsWith("src/") ||
      path.startsWith("node_modules/") ||
      path.startsWith(".git/")
  ),
  false
);
process.stdout.write(`${JSON.stringify(packs, null, 2)}\n`);
