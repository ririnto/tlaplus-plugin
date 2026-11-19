import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  await writeFile(path.join(consumer, "package.json"), JSON.stringify({ private: true }));
  execFileSync(process.execPath, [npm, "install", "--offline", "--no-audit", "--no-fund", tarball], {
    cwd: consumer,
    stdio: "inherit"
  });
  const installed = path.join(consumer, "node_modules/@ririnto/tlaplus-plugin");
  const { version } = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
  await prepareTlaLibrary();
  runMaven([
    "test",
    "-Dtest=InstalledPackageIT",
    `-Dconsumer.node=${process.execPath}`,
    `-Dconsumer.npm=${npm}`,
    `-Dconsumer.directory=${consumer}`,
    `-Dconsumer.version=${version}`
  ]);
} finally {
  await rm(directory, { recursive: true, force: true });
}
