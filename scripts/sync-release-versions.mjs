import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { format } from "oxfmt";

import formatterConfig from "../oxfmt.config.ts";
import { readManifest, readPackageManifest } from "./manifest.mjs";

const file = fileURLToPath(new URL("../package.json", import.meta.url));
const manifest = await readPackageManifest(file);
const optionalDependencies = Object.fromEntries(
  ["darwin-arm64", "linux-arm64", "linux-x64", "win32-x64"].map((platform) => [
    `@ririnto/tlaplus-${platform}`,
    manifest.version
  ])
);
await writeFile(
  file,
  `${JSON.stringify({ ...manifest, optionalDependencies }, null, 2)}\n`
);

await Array.fromAsync(
  [
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".cursor-plugin/plugin.json"
  ],
  async (manifestName) => {
    const pluginFile = fileURLToPath(
      new URL(`../${manifestName}`, import.meta.url)
    );
    const pluginManifest = await readManifest(pluginFile);
    pluginManifest.version = manifest.version;
    const { code, errors } = await format(
      pluginFile,
      JSON.stringify(pluginManifest, null, 2),
      formatterConfig
    );
    if (errors.length > 0) {
      throw new Error(`Could not format ${manifestName}`, { cause: errors });
    }
    await writeFile(pluginFile, code);
  }
);
