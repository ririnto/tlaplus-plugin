import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { prepareTlaLibrary, root, runMaven } from "./jvm.mjs";

const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this check with npm test");
const directory = await mkdtemp(path.join(tmpdir(), "tlaplus-consumer-"));
const consumer = path.join(directory, "consumer project");
try {
  let tarball = process.argv[2] && path.resolve(process.argv[2]);
  if (!tarball) {
    execFileSync(process.execPath, [npm, "pack", "--pack-destination", directory], { cwd: root, stdio: "inherit" });
    const files = (await readdir(directory)).filter(name => name.endsWith(".tgz"));
    if (files.length !== 1) throw new Error("Expected one npm tarball");
    tarball = path.join(directory, files[0]);
  }
  await mkdir(consumer);
  const bin = path.join(directory, "bin");
  await mkdir(bin);
  const node = path.join(bin, path.basename(process.execPath));
  await copyFile(process.execPath, node);
  if (process.platform !== "win32") await chmod(node, 0o755);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(path|java_home(?:_.*)?|jdk_home|jre_home)$/i.test(key)));
  env.PATH = bin;
  if (spawnSync("java", ["-version"], { cwd: consumer, env }).error?.code !== "ENOENT") {
    throw new Error("Java is available in the consumer environment");
  }
  console.log("Consumer environment has no Java executable or JAVA_HOME");
  await writeFile(path.join(consumer, "package.json"), JSON.stringify({ private: true }));
  execFileSync(node, [npm, "install", "--offline", "--no-audit", "--no-fund", tarball], {
    cwd: consumer,
    env,
    stdio: "inherit"
  });
  const installed = path.join(consumer, "node_modules/@ririnto/tlaplus-plugin");
  const { version } = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
  await prepareTlaLibrary();
  runMaven([
    "test",
    "-Dtest=InstalledPackageIT",
    `-Dconsumer.node=${node}`,
    `-Dconsumer.npm=${npm}`,
    `-Dconsumer.directory=${consumer}`,
    `-Dconsumer.version=${version}`
  ]);
} finally {
  await rm(directory, { recursive: true, force: true });
}
