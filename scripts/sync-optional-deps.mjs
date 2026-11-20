import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const file = path.join(root, "package.json");
const manifest = JSON.parse(await readFile(file, "utf8"));
manifest.optionalDependencies = Object.fromEntries(
  ["darwin-arm64", "linux-arm64", "linux-x64", "win32-x64"]
    .sort()
    .map((platform) => [`@ririnto/tlaplus-plugin-${platform}`, manifest.version])
);
await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
