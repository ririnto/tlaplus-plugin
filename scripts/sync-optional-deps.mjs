import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { readPackageManifest } from "./manifest.mjs";

const file = fileURLToPath(new URL("../package.json", import.meta.url));
const manifest = await readPackageManifest(file);
const optionalDependencies = Object.fromEntries(
  [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64-gnu",
    "linux-arm64-musl",
    "linux-x64-gnu",
    "linux-x64-musl",
    "win32-x64"
  ].map((platform) => [
    `@tlaplus-mcp/tlaplus-mcp-${platform}`,
    manifest.version
  ])
);
await writeFile(
  file,
  `${JSON.stringify({ ...manifest, optionalDependencies }, null, 2)}\n`
);
