import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { object, releaseManifest } from "./npm-release-data.mjs";

const [invoked, ...args] = process.argv.slice(2);
const cmd = path.basename(invoked);
const { ARTIFACTS: artifacts, FIXTURE: fixture } = process.env;
const registry = "https://registry.npmjs.org";
assert.ok(artifacts !== undefined && fixture !== undefined);

if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
  console.log(
    execFileSync("git", args, {
      env: { ...process.env, PATH: process.env.REAL_GIT_PATH },
      encoding: "utf-8"
    }).trim()
  );
} else {
  appendFileSync(
    path.join(fixture, "commands.ndjson"),
    `${JSON.stringify([cmd, ...args])}\n`
  );
  const manifest = releaseManifest(
    readFileSync(path.join(artifacts, "npm-release", "manifest.json"), "utf-8")
  );
  if (cmd === "git" && args[0] === "rev-parse") {
    assert.deepEqual(args, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir"
    ]);
    console.log(path.join(fixture, "git-common"));
  } else if (cmd === "git") {
    const ref = `refs/tags/${manifest.gitTag}`;
    assert.deepEqual(args, [
      "ls-remote",
      "--exit-code",
      "https://github.com/ririnto/tlaplus-plugin.git",
      ref,
      `${ref}^{}`
    ]);
    console.log(`${process.env.MOVED_TAG ?? manifest.commit}\t${ref}`);
  } else if (cmd === "gh") {
    assert.deepEqual(args.slice(0, 2), ["release", "create"]);
  } else if (args[0] === "--version") {
    console.log(process.env.FIXTURE_NPM_VERSION ?? "11.19.1");
  } else if (args[0] === "stage") {
    assert.equal(args[1], "publish");
    const tarball = path.relative(artifacts, args[2]);
    const index = manifest.packages.findIndex((pkg) => pkg.tarball === tarball);
    assert.ok(index !== -1, tarball);
    const pkg = manifest.packages[index];
    if (pkg.name === process.env.FAIL_STAGE) {
      console.log("fixture rejected request");
      process.exitCode = 42;
    } else {
      const stageId =
        pkg.name === process.env.WRONG_RECEIPT
          ? undefined
          : `b0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      console.log(
        JSON.stringify({
          [pkg.name]: { ...pkg, version: manifest.version, stageId }
        })
      );
    }
  } else {
    const stateFile = path.join(fixture, "registry.json");
    const state = object(JSON.parse(readFileSync(stateFile, "utf-8")));
    if (args[0] === "view") {
      assert.deepEqual(args.slice(3), [
        "--json",
        "--registry",
        registry,
        "--prefer-online"
      ]);
      if (args[2] === "dist.integrity") {
        const pkg = manifest.packages.find(
          ({ name }) => args[1] === `${name}@${manifest.version}`
        );
        assert.ok(pkg, args[1]);
        console.log(
          JSON.stringify(
            pkg.name === process.env.WRONG_INTEGRITY
              ? "sha512-mismatch"
              : pkg.integrity
          )
        );
      } else {
        assert.equal(args[2], "dist-tags");
        console.log(JSON.stringify(state[args[1]] ?? {}));
      }
    } else {
      assert.deepEqual(args.slice(0, 2), ["dist-tag", "add"]);
      assert.deepEqual(args.slice(4), ["--registry", registry]);
      const pkg = manifest.packages.find(
        ({ name }) => args[2] === `${name}@${manifest.version}`
      );
      assert.ok(pkg, args[2]);
      assert.ok(["latest", manifest.toolsTag].includes(args[3]));
      const otherArtifacts = process.env.OVERLAP_ARTIFACTS;
      if (
        otherArtifacts !== undefined &&
        pkg.name === manifest.packages[0].name &&
        args[3] === manifest.toolsTag
      ) {
        for (const mode of ["promote", "release"]) {
          assert.throws(
            () =>
              execFileSync(
                "bash",
                [
                  "scripts/npm-release.sh",
                  mode,
                  manifest.gitTag,
                  otherArtifacts
                ],
                { encoding: "utf-8", stdio: "pipe" }
              ),
            { status: 1, stderr: /Cannot acquire the npm release lock/u }
          );
          console.log(`Concurrent ${mode} rejected before alias write`);
        }
      }
      object(state[pkg.name])[args[3]] = manifest.version;
      writeFileSync(stateFile, JSON.stringify(state));
    }
  }
}
