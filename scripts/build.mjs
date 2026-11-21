/// <reference lib="esnext.array" />

import { execFileSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

import { prepareTlaLibrary, root, runMaven } from "./jvm.mjs";
import { readPackageManifest } from "./manifest.mjs";

const manifest = await readPackageManifest(path.join(root, "package.json"));
const localGitVariables = new Set(
  execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf-8" })
    .trim()
    .split(/\s+/u)
);
const gitEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !localGitVariables.has(name))
);
const stage = await mkdtemp(path.join(root, ".build-"));
const dist = path.join(stage, "dist");

/**
 * @param {string} repo Repository name in the TLA+ organization.
 * @param {readonly string[]} paths Files or directories to check out.
 */
const checkout = (repo, paths) => {
  const cwd = path.join(stage, repo);
  const options = { cwd, env: gitEnvironment };
  execFileSync("git", ["init", "--quiet", cwd], { env: gitEnvironment });
  execFileSync(
    "git",
    [
      "fetch",
      "--quiet",
      "--depth=1",
      `https://github.com/tlaplus/${repo}.git`,
      "HEAD"
    ],
    options
  );
  execFileSync(
    "git",
    ["checkout", "--quiet", "FETCH_HEAD", "--", ...paths],
    options
  );
  return cwd;
};

try {
  await prepareTlaLibrary();
  const skills = checkout("AgentSkills", ["skills", "LICENSE"]);
  const vscode = checkout("vscode-tlaplus", [
    "resources/knowledgebase",
    "LICENSE"
  ]);
  await cp(path.join(skills, "skills"), path.join(stage, "skills"), {
    recursive: true
  });
  const skillEntries = await readdir(path.join(stage, "skills"), {
    withFileTypes: true
  });
  await Array.fromAsync(skillEntries, async (entry) => {
    if (entry.isDirectory()) {
      await cp(
        path.join(skills, "LICENSE"),
        path.join(stage, "skills", entry.name, "LICENSE")
      );
    }
  });
  await mkdir(dist);
  await cp(
    path.join(vscode, "resources/knowledgebase"),
    path.join(dist, "knowledgebase"),
    {
      recursive: true
    }
  );
  await cp(
    path.join(vscode, "LICENSE"),
    path.join(dist, "knowledgebase/LICENSE")
  );
  const knowledge = path.join(root, "target/generated-resources/knowledgebase");
  await rm(knowledge, { recursive: true, force: true });
  await cp(path.join(dist, "knowledgebase"), knowledge, { recursive: true });
  const articles = await readdir(knowledge, { withFileTypes: true });
  const names = articles
    .filter((article) => article.isFile() && article.name.endsWith(".md"))
    .map((article) => article.name);
  await writeFile(
    path.join(knowledge, "index.txt"),
    `${names.toSorted().join("\n")}\n`
  );
  runMaven(["-Pnative", "package", "native:compile-no-fork"]);
  const platform = `${process.platform}-${process.arch}`;
  const platformSpec = {
    "darwin-arm64": { os: ["darwin"], cpu: ["arm64"] },
    "darwin-x64": { os: ["darwin"], cpu: ["x64"] },
    "linux-arm64": { os: ["linux"], cpu: ["arm64"] },
    "linux-x64": { os: ["linux"], cpu: ["x64"] },
    "win32-x64": { os: ["win32"], cpu: ["x64"] }
  }[platform];
  if (!platformSpec) {
    throw new Error(`Unsupported platform ${platform}`);
  }
  const executable =
    process.platform === "win32" ? "tlaplus-server.exe" : "tlaplus-server";
  const native = path.join(stage, "native");
  const platformPackage = path.join(stage, "npm");
  await mkdir(native);
  await mkdir(platformPackage);
  await cp(
    path.join(root, "target", executable),
    path.join(native, executable)
  );
  await chmod(path.join(native, executable), 0o755);
  await cp(
    path.join(root, "target", executable),
    path.join(platformPackage, executable)
  );
  await chmod(path.join(platformPackage, executable), 0o755);
  const tlaLicense = await fetch(
    "https://raw.githubusercontent.com/tlaplus/tlaplus/v1.7.4/LICENSE",
    {
      signal: AbortSignal.timeout(30_000)
    }
  );
  if (!tlaLicense.ok) {
    throw new Error(
      `TLA+ license download failed with HTTP ${tlaLicense.status}`
    );
  }
  const licenseText = await tlaLicense.text();
  await writeFile(path.join(dist, "TLA-LICENSE"), licenseText);
  await writeFile(path.join(platformPackage, "TLA-LICENSE"), licenseText);
  await writeFile(
    path.join(platformPackage, "package.json"),
    `${JSON.stringify(
      {
        name: `@tlaplus-mcp/tlaplus-mcp-${platform}`,
        version: manifest.version,
        description: `Native TLA+ server binary for ${platform}.`,
        license: manifest.license,
        author: manifest.author,
        repository: manifest.repository,
        engines: manifest.engines,
        files: [executable, "TLA-LICENSE"],
        os: platformSpec.os,
        cpu: platformSpec.cpu
      },
      null,
      2
    )}\n`
  );

  await build({
    absWorkingDir: root,
    entryPoints: ["src/launcher.mts"],
    outfile: path.join(dist, "server.mjs"),
    platform: "node",
    target: "node24",
    format: "esm"
  });
  await chmod(path.join(dist, "server.mjs"), 0o755);
  await Array.fromAsync(["dist", "skills", "native", "npm"], async (name) => {
    await rm(path.join(root, name), { recursive: true, force: true });
    await rename(path.join(stage, name), path.join(root, name));
  });
} finally {
  await rm(stage, { recursive: true, force: true });
}
