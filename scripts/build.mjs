import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const stage = await mkdtemp(path.join(root, ".build-"));
const dist = path.join(stage, "dist");

function checkout(repo, commit, paths) {
  const cwd = path.join(stage, repo);
  execFileSync("git", ["init", "--quiet", cwd]);
  execFileSync("git", ["fetch", "--quiet", "--depth=1", `https://github.com/tlaplus/${repo}.git`, commit], { cwd });
  execFileSync("git", ["checkout", "--quiet", "FETCH_HEAD", "--", ...paths], { cwd });
  return cwd;
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function writeNotices(inputs) {
  const packages = new Set();
  for (const input of Object.keys(inputs)) {
    const match = input.match(/^(.*\bnode_modules\/(?:@[^/]+\/)?[^/]+)/u);
    if (match) packages.add(match[1]);
  }
  const notices = [];
  for (const directory of [...packages].sort()) {
    const location = path.join(root, directory);
    const { name, version } = JSON.parse(await readFile(path.join(location, "package.json"), "utf8"));
    const files = (await readdir(location)).filter(file => /^(?:licen[sc]e|copying|notice)(?:[.-].*)?$/iu.test(file));
    if (!files.length) throw new Error(`Missing license for ${name}`);
    for (const file of files.sort()) {
      notices.push(`${name} ${version} — ${file}\n${await readFile(path.join(location, file), "utf8")}`);
    }
  }
  await writeFile(path.join(dist, "THIRD-PARTY-NOTICES.txt"), notices.join("\n\n"));
}

try {
  const skills = checkout("AgentSkills", "f2adb5e4e2c6250661d1aff8bcc0b9f92d5442ec", ["skills", "LICENSE"]);
  const vscode = checkout("vscode-tlaplus", "4601279e07e479f0cd1a773d53b357308a4194a7", ["resources/knowledgebase", "LICENSE"]);
  await cp(path.join(skills, "skills"), path.join(stage, "skills"), { recursive: true });
  for (const entry of await readdir(path.join(stage, "skills"), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await cp(path.join(skills, "LICENSE"), path.join(stage, "skills", entry.name, "LICENSE"));
    }
  }
  await mkdir(dist);
  await cp(path.join(vscode, "resources/knowledgebase"), path.join(dist, "knowledgebase"), { recursive: true });
  await cp(path.join(vscode, "LICENSE"), path.join(dist, "knowledgebase/LICENSE"));
  const jar = await download("https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar");
  if (createHash("sha256").update(jar).digest("hex") !== "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88") {
    throw new Error("Unexpected SHA-256 for tla2tools.jar v1.7.4");
  }
  await writeFile(path.join(dist, "tla2tools.jar"), jar);
  await writeFile(path.join(dist, "TLA-LICENSE"), await download("https://raw.githubusercontent.com/tlaplus/tlaplus/v1.7.4/LICENSE"));

  const output = await build({
    absWorkingDir: root,
    entryPoints: ["src/server.mts"],
    outfile: path.join(dist, "server.mjs"),
    platform: "node",
    target: "node24",
    format: "esm",
    bundle: true,
    minify: true,
    metafile: true,
    legalComments: "eof",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }
  });
  await writeNotices(output.metafile.inputs);
  await chmod(path.join(dist, "server.mjs"), 0o755);
  for (const name of ["dist", "skills"]) {
    await rm(path.join(root, name), { recursive: true, force: true });
    await rename(path.join(stage, name), path.join(root, name));
  }
} finally {
  await rm(stage, { recursive: true, force: true });
}
