import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
const tlaVersion = "1.7.4";
const tlaDigest = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const tlaRelease = `https://github.com/tlaplus/tlaplus/releases/download/v${tlaVersion}/tla2tools.jar`;

export function runMaven(args) {
  const options = { cwd: root, stdio: "inherit" };
  if (process.platform === "win32") {
    const command = ["mvn.cmd", "-B", "-ntp", ...args].map(argument => `"${argument}"`).join(" ");
    execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${command}"`], {
      ...options,
      windowsVerbatimArguments: true
    });
  } else {
    execFileSync("mvn", ["-B", "-ntp", ...args], options);
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
