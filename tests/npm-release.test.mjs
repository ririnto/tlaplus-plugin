import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { nativePlatform } from "../src/native-platform.mjs";
import {
  array,
  object,
  releaseManifest
} from "./fixtures/npm-release-data.mjs";

const main = "@tlaplus-mcp/tlaplus-mcp";
const platforms = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64-gnu",
  "linux-arm64-musl",
  "linux-x64-gnu",
  "linux-x64-musl",
  "win32-x64"
];
const names = [...platforms.map((platform) => `${main}-${platform}`), main];
const tag = "2026.12.12.01";
const version = "1.7.4-2026.12.12.1";
const holding = `staged-${version}`;
const tools = "tlaplus-1.7.4";
const registry = "https://registry.npmjs.org";
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "tlaplus-release-")));
const packs = path.join(root, "packs");
const source = path.join(root, "source");
const repo = fileURLToPath(new URL("../", import.meta.url));
const shim = fileURLToPath(
  new URL("fixtures/npm-release-command.mjs", import.meta.url)
);
const baseEnv = { HOME: process.env.HOME, PATH: process.env.PATH };
/** @type {string[]} */
const paths = [];
/** @type {string} */
let workspace;
/** @type {string} */
let artifacts;
/** @type {ReturnType<typeof releaseManifest>} */
let manifest;
/** @type {NodeJS.ProcessEnv} */
let fixtureEnv;

/** @param {string[]} args npm arguments. */
const realNpm = (args) =>
  execFileSync(
    "npm",
    [
      ...args,
      "--offline",
      "--userconfig=/dev/null",
      "--cache",
      path.join(root, "cache")
    ],
    { cwd: source, env: baseEnv, encoding: "utf-8" }
  );

/**
 * @param {string} mode Release command.
 * @param {number} [status] Expected process exit.
 * @param {NodeJS.ProcessEnv} [env] Fixture overrides.
 */
const invoke = (mode, status = 0, env = {}) => {
  const result = spawnSync(
    "bash",
    ["scripts/npm-release.sh", mode, tag, artifacts],
    {
      cwd: repo,
      env: { ...fixtureEnv, ...env },
      encoding: "utf-8"
    }
  );
  assert.equal(result.status, status, result.stdout + result.stderr);
  return result;
};

/** @param {string} file Record file. */
const readRecords = (file) => {
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf-8").trim().split("\n");
};

const stageRecords = () =>
  readRecords(path.join(artifacts, "npm-stage", "submissions.ndjson")).map(
    (line) => object(JSON.parse(line))
  );

/** @param {...string} prefix Leading command arguments. */
const calls = (...prefix) =>
  readRecords(path.join(workspace, "commands.ndjson"))
    .map((line) => array(JSON.parse(line)))
    .filter((call) => prefix.every((arg, index) => arg === call[index]));

/**
 * @param {string[]} [approved] Packages approved in the fixture.
 * @returns {Record<string, Record<string, string>>} Tags by package.
 */
const registryState = (approved = names) => {
  const older = "1.7.4-2026.12.9.9";
  return Object.fromEntries(
    approved.map((name) => [
      name,
      {
        [holding]: version,
        latest: older,
        [tools]: older
      }
    ])
  );
};

/** @param {Record<string, Record<string, string>>} state Tags by package. */
const setRegistry = (state) => {
  writeFileSync(path.join(workspace, "registry.json"), JSON.stringify(state));
};

try {
  await describe(
    "npm release",
    {
      skip:
        process.platform === "win32"
          ? "The release workflow uses a POSIX Bash runner"
          : false
    },
    () => {
      before(() => {
        mkdirSync(source);
        for (const [index, platform] of [
          ...platforms,
          "linux-x64-gnu"
        ].entries()) {
          const name = names[index];
          const destination = path.join(packs, `npm-package-${platform}`);
          mkdirSync(destination, { recursive: true });
          writeFileSync(
            path.join(source, "package.json"),
            JSON.stringify({
              name,
              version,
              ...(name === main && {
                optionalDependencies: Object.fromEntries(
                  names.slice(0, -1).map((pkg) => [pkg, version])
                )
              })
            })
          );
          const [receipt] = array(
            JSON.parse(
              realNpm([
                "pack",
                "--ignore-scripts",
                "--json",
                "--pack-destination",
                destination
              ])
            )
          );
          const { filename } = object(receipt);
          assert.ok(typeof filename === "string");
          paths.push(path.relative(packs, path.join(destination, filename)));
        }
      });

      beforeEach(() => {
        workspace = mkdtempSync(path.join(root, "scenario "));
        artifacts = path.join(workspace, "release artifacts");
        cpSync(packs, artifacts, { recursive: true });
        const bin = path.join(workspace, "bin");
        mkdirSync(bin);
        mkdirSync(path.join(workspace, "git-common"));
        for (const command of ["npm", "git", "gh", "env"]) {
          writeFileSync(
            path.join(bin, command),
            '#!/bin/sh\nexec "$FIXTURE_NODE" "$FIXTURE_SHIM" "$0" "$@"\n',
            { mode: 0o755 }
          );
        }
        fixtureEnv = {
          ...baseEnv,
          PATH: `${bin}${path.delimiter}${baseEnv.PATH}`,
          REAL_GIT_PATH: baseEnv.PATH,
          ARTIFACTS: artifacts,
          FIXTURE: workspace,
          FIXTURE_NODE: process.execPath,
          FIXTURE_SHIM: shim
        };
        mkdirSync(path.join(artifacts, "npm-release"));
        manifest = releaseManifest(invoke("prepare").stdout);
        writeFileSync(
          path.join(artifacts, "npm-release", "manifest.json"),
          JSON.stringify(manifest)
        );
      });

      void test("stages the exact eight npm pack tarballs with release-specific tags", () => {
        assert.deepEqual(
          manifest.packages.map((pkg) => pkg.name),
          names
        );
        assert.deepEqual(
          manifest.packages.map((pkg) => pkg.tarball),
          paths
        );
        assert.equal(manifest.holdingTag, holding);
        invoke("stage");
        const submitted = stageRecords().filter(
          (record) => record.state === "submitted"
        );
        assert.equal(
          new Set(submitted.map((record) => record.stageId)).size,
          names.length
        );
        const submissions = calls("npm", "stage", "publish");
        assert.equal(submissions.length, names.length);
        for (const [index, pkg] of manifest.packages.entries()) {
          const args = [
            "stage",
            "publish",
            path.join(artifacts, pkg.tarball),
            "--access",
            "public",
            "--tag",
            holding,
            "--registry",
            registry,
            "--provenance",
            "--json",
            "--fetch-retries=0"
          ];
          assert.deepEqual(submissions[index], ["npm", ...args]);
          const receipt = object(
            object(JSON.parse(realNpm([...args, "--dry-run"])))[pkg.name]
          );
          assert.equal(receipt.integrity, pkg.integrity);
          assert.equal(receipt.shasum, pkg.shasum);
          assert.equal(receipt.stageId, undefined);
        }
      });

      void test("preflight rejects a missing, duplicate, or wrong-identity tarball", () => {
        const first = path.join(artifacts, paths[0]);
        const original = readFileSync(first);
        rmSync(first);
        assert.ok(invoke("stage", 1).stderr.includes(paths[0]));
        writeFileSync(first, original);
        const duplicate = first.replace(version, "1.0.0");
        writeFileSync(duplicate, original);
        assert.ok(invoke("stage", 1).stderr.includes(paths[0]));
        rmSync(duplicate);
        writeFileSync(first, readFileSync(path.join(artifacts, paths[1])));
        assert.ok(invoke("stage", 1).stderr.includes(names[0]));
        assert.deepEqual(calls("npm", "stage"), []);
      });

      void test("preserves confirmed receipts and does not retry after a partial failure", () => {
        assert.match(
          invoke("stage", 1, { FIXTURE_NPM_VERSION: "11.14.0" }).stderr,
          /npm 11\.15\.0 or later/u
        );
        assert.deepEqual(calls("npm", "stage"), []);
        const result = invoke("stage", 1, { FAIL_STAGE: names[2] });
        assert.match(result.stderr, /npm exited 42/u);
        assert.match(result.stderr, /fixture rejected request/u);
        const records = stageRecords();
        assert.equal(records.at(-1).state, "unconfirmed");
        assert.deepEqual(
          records
            .filter((record) => record.state === "submitted")
            .map((record) => record.name),
          names.slice(0, 2)
        );
        invoke("stage", 1, { GITHUB_RUN_ATTEMPT: "2" });
        invoke("stage", 1);
        assert.equal(calls("npm", "stage", "publish").length, 3);
        assert.match(invoke("promote", 1).stderr, /confirmed submission/u);
      });

      void test("flags an npm response without a matching stage ID as unconfirmed", () => {
        assert.match(
          invoke("stage", 1, { WRONG_RECEIPT: names[0] }).stderr,
          /without a matching stage receipt/u
        );
        const records = stageRecords();
        assert.equal(records.at(-1).state, "unconfirmed");
        assert.equal(calls("npm", "stage", "publish").length, 1);
      });

      void test("requires approvals, exact integrity, both dist-tags, and a consumer smoke before creating the GitHub Release", () => {
        invoke("stage");
        setRegistry(registryState(names.slice(0, -2)));
        invoke("platforms", 1);
        setRegistry(registryState(names.slice(0, -1)));
        invoke("platforms");
        invoke("promote", 1);
        setRegistry(registryState());
        assert.match(
          invoke("promote", 1, { WRONG_INTEGRITY: main }).stderr,
          /does not have the release tarball integrity/u
        );
        assert.deepEqual(calls("npm", "dist-tag"), []);
        invoke("release", 1);
        assert.deepEqual(calls("gh"), []);
        assert.deepEqual(calls("env"), []);
        invoke("promote");
        assert.deepEqual(
          calls("npm", "dist-tag", "add").map((call) => call.slice(3, 5)),
          names.flatMap((name) => [
            [`${name}@${version}`, tools],
            [`${name}@${version}`, "latest"]
          ])
        );
        invoke("release", 42, { FAIL_SMOKE: "1" });
        const smoke = [
          process.execPath,
          "scripts/registry-smoke.mjs",
          version,
          tools,
          nativePlatform(),
          registry
        ];
        const smokeCalls = () =>
          calls("env").map((call) => {
            const [, flag, home, smokePath] = call;
            assert.equal(flag, "-i");
            assert.ok(typeof home === "string" && home.startsWith("HOME="));
            assert.notEqual(home, `HOME=${baseEnv.HOME}`);
            assert.ok(!existsSync(home.slice("HOME=".length)));
            assert.equal(smokePath, `PATH=${path.dirname(process.execPath)}`);
            return call.slice(4);
          });
        assert.deepEqual(smokeCalls(), [smoke]);
        assert.deepEqual(calls("gh"), []);
        invoke("release", 1, { MOVED_TAG: "mismatch" });
        assert.deepEqual(smokeCalls(), [smoke, smoke]);
        assert.deepEqual(calls("gh"), []);
        invoke("release");
        assert.deepEqual(smokeCalls(), [smoke, smoke, smoke]);
        assert.deepEqual(calls("gh", "release", "create"), [
          [
            "gh",
            "release",
            "create",
            tag,
            "--repo",
            "ririnto/tlaplus-plugin",
            "--verify-tag",
            "--generate-notes",
            ...paths.map((tarball) => path.join(artifacts, tarball))
          ]
        ]);
      });

      void test("an older approval cannot move either consumer alias", () => {
        invoke("stage");
        for (const alias of ["latest", tools]) {
          const state = registryState();
          state[main][alias] = "1.7.4-2026.12.12.10";
          setRegistry(state);
          assert.match(invoke("promote", 1).stderr, /Cannot use/u);
          assert.deepEqual(
            JSON.parse(
              readFileSync(path.join(workspace, "registry.json"), "utf-8")
            ),
            state
          );
        }
        assert.deepEqual(calls("npm", "dist-tag"), []);
      });

      void test("blocks another promotion or finalization during an alias write", () => {
        invoke("stage");
        setRegistry(registryState());
        const otherArtifacts = path.join(workspace, "other artifacts");
        cpSync(artifacts, otherArtifacts, { recursive: true });
        const promoted = invoke("promote", 0, {
          OVERLAP_ARTIFACTS: otherArtifacts
        });
        assert.match(
          promoted.stdout,
          /Concurrent promote rejected before alias write/u
        );
        assert.match(
          promoted.stdout,
          /Concurrent release rejected before alias write/u
        );
        assert.equal(calls("npm", "dist-tag", "add").length, names.length * 2);
        assert.deepEqual(calls("gh"), []);
        invoke("release");
      });
    }
  );
} finally {
  rmSync(root, { force: true, recursive: true });
}
