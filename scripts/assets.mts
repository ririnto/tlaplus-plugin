import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "./command.mts";

const root = new URL("../", import.meta.url);

const skills = [
  "tlaplus-add-variable",
  "tlaplus-split-action",
  "tlaplus-from-source"
];
const jarSha1 = "bee4a54f3ee3d4afc347c3240ec2d9e93b075104";
const stage = await mkdtemp(fileURLToPath(new URL(".assets-", root)));
const download = async (url: string, destination: string): Promise<void> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Download failed: ${url}: HTTP ${response.status}`);
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
};
const settleAll = async (tasks: Promise<void>[]): Promise<void> => {
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected") {
      const reason: unknown = result.reason;
      throw reason instanceof Error ? reason : new Error(String(reason));
    }
  }
};
try {
  const vendor = path.join(stage, "vendor");
  await mkdir(vendor);
  const jar = path.join(vendor, "tla2tools.jar");
  await download(
    "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar",
    jar
  );
  const hash = createHash("sha1")
    .update(await readFile(jar))
    .digest("hex");
  if (hash !== jarSha1) {
    throw new Error(`tla2tools.jar SHA1 mismatch: ${hash}`);
  }
  await download(
    "https://raw.githubusercontent.com/tlaplus/tlaplus/v1.7.4/LICENSE",
    path.join(vendor, "LICENSE")
  );
  const archive = path.join(stage, "skills.tar.gz");
  await download(
    "https://github.com/tlaplus/AgentSkills/archive/refs/heads/main.tar.gz",
    archive
  );
  await run("tar", ["-xzf", archive, "-C", stage]);
  const upstream = path.join(stage, "AgentSkills-main");
  const license = await readFile(path.join(upstream, "LICENSE"));
  const target = path.join(stage, "skills");
  await mkdir(target);
  await settleAll(
    skills.map(async (skill) => {
      await cp(path.join(upstream, "skills", skill), path.join(target, skill), {
        recursive: true
      });
      await writeFile(path.join(target, skill, "LICENSE"), license);
      await readFile(path.join(target, skill, "SKILL.md"));
    })
  );
  const probe = path.join(stage, "Probe.tla");
  await writeFile(
    probe,
    "---- MODULE Probe ----\nEXTENDS Naturals\nASSUME 1 = 1\n====\n"
  );
  const result = await run("java", ["-cp", jar, "tla2sany.SANY", probe], {
    timeout: 30_000
  });
  if (!result.stdout.includes("Semantic processing of module Probe")) {
    throw new Error(
      `SANY probe did not confirm semantic analysis: ${result.stdout}\n${result.stderr}`
    );
  }
  await settleAll(
    ["vendor", "skills"].map(async (name) => {
      await rm(new URL(name, root), { recursive: true, force: true });
      await rename(path.join(stage, name), new URL(name, root));
    })
  );
  await chmod(new URL("dist/server.mjs", root), 0o755);
  process.stderr.write(
    `Verified tla2tools 1.7.4 SHA1 ${hash}; SANY main tla2sany.SANY; ${skills.length} skills.\n`
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
