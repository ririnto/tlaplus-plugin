import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

import { prepareTlaLibrary, root, runMaven } from "./jvm.mjs";

const stage = await mkdtemp(path.join(root, ".build-"));
const dist = path.join(stage, "dist");

function checkout(repo, paths) {
  const cwd = path.join(stage, repo);
  execFileSync("git", ["init", "--quiet", cwd]);
  execFileSync("git", ["fetch", "--quiet", "--depth=1", `https://github.com/tlaplus/${repo}.git`, "HEAD"], { cwd });
  execFileSync("git", ["checkout", "--quiet", "FETCH_HEAD", "--", ...paths], { cwd });
  return cwd;
}

try {
  await prepareTlaLibrary();
  runMaven(["package"]);
  const skills = checkout("AgentSkills", ["skills", "LICENSE"]);
  const vscode = checkout("vscode-tlaplus", ["resources/knowledgebase", "LICENSE"]);
  await cp(path.join(skills, "skills"), path.join(stage, "skills"), { recursive: true });
  for (const entry of await readdir(path.join(stage, "skills"), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await cp(path.join(skills, "LICENSE"), path.join(stage, "skills", entry.name, "LICENSE"));
    }
  }
  await mkdir(dist);
  await cp(path.join(vscode, "resources/knowledgebase"), path.join(dist, "knowledgebase"), { recursive: true });
  await cp(path.join(vscode, "LICENSE"), path.join(dist, "knowledgebase/LICENSE"));
  await cp(path.join(root, "target/tlaplus-server.jar"), path.join(dist, "tlaplus-server.jar"));
  const tlaLicense = await fetch("https://raw.githubusercontent.com/tlaplus/tlaplus/v1.7.4/LICENSE", {
    signal: AbortSignal.timeout(30_000)
  });
  if (!tlaLicense.ok) throw new Error(`TLA+ license download failed with HTTP ${tlaLicense.status}`);
  await writeFile(path.join(dist, "TLA-LICENSE"), await tlaLicense.text());

  const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  await build({
    absWorkingDir: root,
    entryPoints: ["src/launcher.mts"],
    outfile: path.join(dist, "server.mjs"),
    platform: "node",
    target: "node24",
    format: "esm",
    define: { TLA_PLUGIN_VERSION: JSON.stringify(version) }
  });
  await chmod(path.join(dist, "server.mjs"), 0o755);
  for (const name of ["dist", "skills"]) {
    await rm(path.join(root, name), { recursive: true, force: true });
    await rename(path.join(stage, name), path.join(root, name));
  }
} finally {
  await rm(stage, { recursive: true, force: true });
}
