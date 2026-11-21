import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { readPackageManifest } from "./manifest.mjs";

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
