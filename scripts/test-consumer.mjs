import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { linuxLibc, nativePlatform } from "../src/native-platform.mjs";
import { prepareTlaLibrary, root, runMaven } from "./jvm.mjs";
import { readPackageManifest } from "./manifest.mjs";

const npm = process.env.npm_execpath;
if (npm === undefined || npm.length === 0) {
  throw new Error("Run this check with npm test");
}
const directory = await mkdtemp(path.join(tmpdir(), "tlaplus-consumer-"));
const consumer = path.join(directory, "consumer project");
const platform = nativePlatform();
const packageName = "@tlaplus-mcp/tlaplus-mcp";
try {
  const mainArg = process.argv.at(2);
  const platformArg = process.argv.at(3);
  let mainTarball =
    mainArg === undefined || mainArg === "" ? mainArg : path.resolve(mainArg);
  let platformTarball =
    platformArg === undefined || platformArg === ""
      ? platformArg
      : path.resolve(platformArg);
  if (
    mainTarball === undefined ||
    mainTarball === "" ||
    platformTarball === undefined ||
    platformTarball === ""
  ) {
    execFileSync(
      process.execPath,
      [npm, "pack", "--pack-destination", directory],
      {
        cwd: root,
        stdio: "inherit"
      }
    );
    execFileSync(
      process.execPath,
      [npm, "pack", "./npm", "--pack-destination", directory],
      {
        cwd: root,
        stdio: "inherit"
      }
    );
  }
  const entries = await readdir(directory);
  const packed = entries.filter((name) => name.endsWith(".tgz"));
  const mainName = packed.find((name) =>
    /^tlaplus-mcp-tlaplus-mcp-[0-9]/u.test(name)
  );
  const platformPrefix = `tlaplus-mcp-tlaplus-mcp-${platform}-`;
  const platformName = packed.find(
    (name) =>
      name.startsWith(platformPrefix) &&
      /[0-9]/u.test(name.charAt(platformPrefix.length))
  );
  mainTarball ??=
    mainName === undefined ? undefined : path.join(directory, mainName);
  platformTarball ??=
    platformName === undefined ? undefined : path.join(directory, platformName);
  if (
    mainTarball === undefined ||
    mainTarball === "" ||
    platformTarball === undefined ||
    platformTarball === ""
  ) {
    throw new Error("Expected one main tarball and one platform tarball");
  }
  await mkdir(consumer);
  const bin = path.join(directory, "bin");
  await mkdir(bin);
  const node = path.join(bin, path.basename(process.execPath));
  await copyFile(process.execPath, node);
  if (process.platform !== "win32") {
    await chmod(node, 0o755);
  }
  /** @type {NodeJS.ProcessEnv} */
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:path|java_home(?:_.*)?|jd(?-i:[Kk])_home|jre_home)$/iu.test(key)
    )
  );
  env.PATH = bin;
  const { error } = spawnSync("java", ["-version"], { cwd: consumer, env });
  if (error === undefined || !("code" in error) || error.code !== "ENOENT") {
    throw new Error("Java is available in the consumer environment");
  }
  console.log("Consumer environment has no Java executable or JAVA_HOME");
  await writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      overrides: {
        [`${packageName}-${platform}`]: pathToFileURL(platformTarball).href
      }
    })
  );
  execFileSync(
    node,
    [npm, "install", "--offline", "--no-audit", "--no-fund", mainTarball],
    {
      cwd: consumer,
      env,
      stdio: "inherit"
    }
  );
  const installed = path.join(
    consumer,
    "node_modules/@tlaplus-mcp/tlaplus-mcp"
  );
  const mainFiles = await readdir(installed);
  assert.deepEqual(mainFiles.toSorted(), [
    "LICENSE",
    "README.md",
    "dist",
    "package.json"
  ]);
  const dist = path.join(installed, "dist");
  const distFiles = await readdir(dist);
  assert.deepEqual(distFiles.toSorted(), [
    "TLA-LICENSE",
    "knowledgebase",
    "server.mjs"
  ]);
  const knowledge = await readdir(path.join(dist, "knowledgebase"), {
    withFileTypes: true
  });
  const knowledgeFiles = knowledge.map((entry) => entry.name).toSorted();
  assert.ok(knowledgeFiles.includes("LICENSE"));
  assert.ok(knowledgeFiles.includes("tlc-config-files.md"));
  assert.ok(
    knowledge.every(
      (entry) =>
        entry.isFile() &&
        (entry.name === "LICENSE" || entry.name.endsWith(".md"))
    )
  );
  const nativePackage = path.join(
    consumer,
    `node_modules/${packageName}-${platform}`
  );
  const platformFiles = await readdir(nativePackage);
  const libc = linuxLibc();
  if (libc !== null) {
    const manifest = await readPackageManifest(
      path.join(nativePackage, "package.json")
    );
    assert.deepEqual(manifest.libc, [libc]);
  }
  assert.deepEqual(platformFiles.toSorted(), [
    "TLA-LICENSE",
    "package.json",
    process.platform === "win32" ? "tlaplus-server.exe" : "tlaplus-server"
  ]);
  console.log("Main package entries:", mainFiles.toSorted().join(", "));
  console.log("Main dist entries:", distFiles.toSorted().join(", "));
  console.log("Main knowledgebase entries:", knowledgeFiles.join(", "));
  console.log(
    `npm selected ${packageName}-${platform} as an optional dependency`
  );
  console.log("Platform package entries:", platformFiles.toSorted().join(", "));
  const { version } = await readPackageManifest(
    path.join(installed, "package.json")
  );
  await prepareTlaLibrary();
  runMaven([
    "test",
    "-Dtest=InstalledPackageIT",
    `-Dconsumer.node=${node}`,
    `-Dconsumer.npm=${npm}`,
    `-Dconsumer.directory=${consumer}`,
    `-Dconsumer.version=${version}`,
    `-Dconsumer.platform=${platform}`
  ]);
} finally {
  await rm(directory, { recursive: true, force: true });
}
