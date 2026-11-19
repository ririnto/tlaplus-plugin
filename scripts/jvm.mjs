import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";

export const root = fileURLToPath(new URL("../", import.meta.url));
const tlaVersion = "1.7.4";
const tlaDigest = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const tlaRelease = `https://github.com/tlaplus/tlaplus/releases/download/v${tlaVersion}/tla2tools.jar`;

export function runMaven(args) {
  const result = spawn.sync("mvn", ["-B", "-ntp", ...args], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Maven exited with ${result.signal || result.status}`);
  }
}

export async function prepareTlaLibrary() {
  const target = path.join(root, "target");
  const jar = path.join(target, `tla2tools-${tlaVersion}.jar`);
  let bytes;
  try {
    bytes = await readFile(jar);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(tlaRelease, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`TLA+ download failed with HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== tlaDigest) {
    throw new Error(`SHA-256 mismatch for ${jar}`);
  }
  await mkdir(target, { recursive: true });
  await writeFile(jar, bytes);
  runMaven([
    "org.apache.maven.plugins:maven-install-plugin:3.1.4:install-file",
    `-Dfile=${jar}`,
    "-DgroupId=org.lamport",
    "-DartifactId=tla2tools",
    `-Dversion=${tlaVersion}`,
    "-Dpackaging=jar"
  ]);
}
