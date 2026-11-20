/// <reference path="./cross-spawn.d.ts" />

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sync } from "cross-spawn";

import { readPackageManifest } from "./manifest.mjs";
import { tlaVersion } from "./tla-version.mjs";

/**
 * The repository root used by Maven and packaging commands.
 */
export const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = await readPackageManifest(path.join(root, "package.json"));
const tlaRelease = `https://github.com/tlaplus/tlaplus/releases/download/v${tlaVersion}/tla2tools.jar`;

/**
 * Runs Maven from the repository root with the package version.
 * @param {readonly string[]} args Maven goals and additional command-line options.
 */
export const runMaven = (args) => {
  const { error, status, signal } = sync(
    "mvn",
    ["-B", "-ntp", `-Drevision=${version}`, ...args],
    {
      cwd: root,
      stdio: "inherit"
    }
  );
  if (error !== null) {
    throw error;
  }
  if (status !== 0) {
    throw new Error(`Maven exited with ${signal ?? status}`);
  }
};

/**
 * Installs the TLA+ tools JAR into the local Maven repository.
 */
export const prepareTlaLibrary = async () => {
  const target = path.join(root, "target");
  const jar = path.join(target, `tla2tools-${tlaVersion}.jar`);
  let bytes;
  try {
    bytes = await readFile(jar);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
    const response = await fetch(tlaRelease, {
      signal: AbortSignal.timeout(120_000)
    });
    if (!response.ok) {
      throw new Error(`TLA+ download failed with HTTP ${response.status}`, {
        cause: error
      });
    }
    bytes = Buffer.from(await response.arrayBuffer());
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
};
