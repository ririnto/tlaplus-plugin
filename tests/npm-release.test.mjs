import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
import { text } from "node:stream/consumers";
import { before, describe, test } from "node:test";
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
const bin = path.join(root, "bin");
const repo = fileURLToPath(new URL("../", import.meta.url));
const shim = fileURLToPath(
  new URL("fixtures/npm-release-command.mjs", import.meta.url)
);
const baseEnv = {
  HOME: process.env.HOME,
  PATH: [path.dirname(process.execPath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter)
};
/** @type {string[]} */
const paths = [];
/** @type {ReturnType<typeof releaseManifest>} */
let manifest;

/**
 * @param {string} command Executable to run.
 * @param {string[]} args Command arguments.
 * @param {{cwd: string, env: NodeJS.ProcessEnv}} options Working directory and environment.
 * @param {number} [status] Expected exit.
 */
const run = async (command, args, { cwd, env }, status = 0) => {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const [stdout, stderr, exit] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    once(child, "close")
  ]);
  assert.equal(exit.at(0), status, stdout + stderr);
  return { stdout, stderr };
};

/**
 * @param {string[]} args npm arguments.
 * @param {string} [cwd] Source package directory.
 */
const realNpm = async (args, cwd = source) => {
  const { stdout, stderr } = await run(
    "npm",
    [
      ...args,
      "--offline",
      "--userconfig=/dev/null",
      "--cache",
      path.join(root, "cache")
    ],
    { cwd, env: baseEnv }
  );
  process.stderr.write(stderr);
  return stdout;
};

/**
 * @param {string} artifacts Packaged release artifacts.
 * @param {NodeJS.ProcessEnv} fixtureEnv Release command environment.
 * @param {string} mode Release command.
 * @param {number} [status] Expected process exit.
 * @param {NodeJS.ProcessEnv} [env] Fixture overrides.
 */
const runRelease = async (artifacts, fixtureEnv, mode, status = 0, env = {}) =>
  await run(
    "bash",
    ["scripts/npm-release.sh", mode, tag, artifacts],
    { cwd: repo, env: { ...fixtureEnv, ...env } },
    status
  );

/**
 * @template T
 * @param {Promise<T>[]} tasks Operations that share the temporary root.
 */
const finishAll = async (tasks) => {
  const results = await Promise.allSettled(tasks);
  return results.map((result) => {
    if (result.status === "rejected") {
      throw new Error("Release test operation failed", {
        cause: result.reason
      });
    }
    return result.value;
  });
};

/** @param {string} file Record file. */
const readRecords = (file) => {
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf-8").trim().split("\n");
};

const scenario = () => {
  const workspace = mkdtempSync(path.join(root, "scenario "));
  const artifacts = path.join(workspace, "release artifacts");
  cpSync(packs, artifacts, { recursive: true });
  mkdirSync(path.join(workspace, "git-common"));
  return {
    artifacts,
    workspace,
    invoke: runRelease.bind(null, artifacts, {
      ...baseEnv,
      PATH: `${bin}${path.delimiter}${baseEnv.PATH}`,
      REAL_GIT_PATH: baseEnv.PATH,
      ARTIFACTS: artifacts,
      FIXTURE: workspace,
      FIXTURE_NODE: process.execPath,
      FIXTURE_SHIM: shim
    }),
    stageRecords: () =>
      readRecords(path.join(artifacts, "npm-stage", "submissions.ndjson")).map(
        (line) => object(JSON.parse(line))
      ),
    /** @param {...string} prefix Leading command arguments. */
    calls: (...prefix) =>
      readRecords(path.join(workspace, "commands.ndjson"))
        .map((line) => array(JSON.parse(line)))
        .filter((call) => prefix.every((arg, index) => arg === call[index])),
    /** @param {Record<string, Record<string, string>>} state Tags by package. */
    setRegistry: (state) => {
      writeFileSync(
        path.join(workspace, "registry.json"),
        JSON.stringify(state)
      );
    }
  };
};

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

try {
  await describe(
    "npm release",
    {
      concurrency: true,
      skip:
        process.platform === "win32"
          ? "The release workflow uses a POSIX Bash runner"
          : false
    },
    () => {
      before(async () => {
        paths.push(
          ...(await finishAll(
            [...platforms, "linux-x64-gnu"].map(async (platform, index) => {
              const name = names[index];
              const cwd = name === main ? source : path.join(root, platform);
              const destination = path.join(packs, `npm-package-${platform}`);
              mkdirSync(cwd);
              mkdirSync(destination, { recursive: true });
              writeFileSync(
                path.join(cwd, "package.json"),
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
                  await realNpm(
                    [
                      "pack",
                      "--ignore-scripts",
                      "--json",
                      "--pack-destination",
                      destination
                    ],
                    cwd
                  )
                )
              );
              const { filename } = object(receipt);
              assert.ok(typeof filename === "string");
              return path.relative(packs, path.join(destination, filename));
            })
          ))
        );
        mkdirSync(bin);
        for (const command of ["npm", "git", "gh", "env"]) {
          writeFileSync(
            path.join(bin, command),
            '#!/bin/sh\nexec "$FIXTURE_NODE" "$FIXTURE_SHIM" "$0" "$@"\n',
            { mode: 0o755 }
          );
        }
        mkdirSync(path.join(packs, "npm-release"));
        const { stdout } = await runRelease(packs, baseEnv, "prepare");
        manifest = releaseManifest(stdout);
        writeFileSync(
          path.join(packs, "npm-release", "manifest.json"),
          JSON.stringify(manifest)
        );
      });

      void test("stages the exact eight npm pack tarballs with release-specific tags", async () => {
        const { artifacts, calls, invoke, stageRecords } = scenario();
        assert.deepEqual(
          manifest.packages.map((pkg) => pkg.name),
          names
        );
        assert.deepEqual(
          manifest.packages.map((pkg) => pkg.tarball),
          paths
        );
        assert.equal(manifest.holdingTag, holding);
        await invoke("stage");
        const submitted = stageRecords().filter(
          (record) => record.state === "submitted"
        );
        assert.equal(
          new Set(submitted.map((record) => record.stageId)).size,
          names.length
        );
        const submissions = calls("npm", "stage", "publish");
        assert.equal(submissions.length, names.length);
        await finishAll(
          manifest.packages.map(async (pkg, index) => {
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
              object(JSON.parse(await realNpm([...args, "--dry-run"])))[
                pkg.name
              ]
            );
            assert.equal(receipt.integrity, pkg.integrity);
            assert.equal(receipt.shasum, pkg.shasum);
            assert.equal(receipt.stageId, undefined);
          })
        );
      });

      void test("preflight rejects a missing, duplicate, or wrong-identity tarball", async () => {
        const { artifacts, calls, invoke } = scenario();
        const first = path.join(artifacts, paths[0]);
        const original = readFileSync(first);
        rmSync(first);
        const { stderr: missing } = await invoke("stage", 1);
        assert.ok(missing.includes(paths[0]));
        writeFileSync(first, original);
        const duplicate = first.replace(version, "1.0.0");
        writeFileSync(duplicate, original);
        const { stderr: duplicated } = await invoke("stage", 1);
        assert.ok(duplicated.includes(paths[0]));
        rmSync(duplicate);
        writeFileSync(first, readFileSync(path.join(artifacts, paths[1])));
        const { stderr: wrongIdentity } = await invoke("stage", 1);
        assert.ok(wrongIdentity.includes(names[0]));
        assert.deepEqual(calls("npm", "stage"), []);
      });

      void test("preserves confirmed receipts and does not retry after a partial failure", async () => {
        const { calls, invoke, stageRecords } = scenario();
        const { stderr: unsupportedNpm } = await invoke("stage", 1, {
          FIXTURE_NPM_VERSION: "11.14.0"
        });
        assert.match(unsupportedNpm, /npm 11\.15\.0 or later/u);
        assert.deepEqual(calls("npm", "stage"), []);
        const result = await invoke("stage", 1, { FAIL_STAGE: names[2] });
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
        await invoke("stage", 1, { GITHUB_RUN_ATTEMPT: "2" });
        await invoke("stage", 1);
        assert.equal(calls("npm", "stage", "publish").length, 3);
        const { stderr: incompleteStage } = await invoke("promote", 1);
        assert.match(incompleteStage, /confirmed submission/u);
      });

      void test("flags an npm response without a matching stage ID as unconfirmed", async () => {
        const { calls, invoke, stageRecords } = scenario();
        const { stderr } = await invoke("stage", 1, {
          WRONG_RECEIPT: names[0]
        });
        assert.match(stderr, /without a matching stage receipt/u);
        const records = stageRecords();
        assert.equal(records.at(-1).state, "unconfirmed");
        assert.equal(calls("npm", "stage", "publish").length, 1);
      });

      void test("requires approvals, exact integrity, both dist-tags, and a consumer smoke before creating the GitHub Release", async () => {
        const { artifacts, calls, invoke, setRegistry } = scenario();
        await invoke("stage");
        const approval = scenario();
        const integrity = scenario();
        for (const copy of [approval, integrity]) {
          cpSync(
            path.join(artifacts, "npm-stage"),
            path.join(copy.artifacts, "npm-stage"),
            { recursive: true }
          );
        }

        const checkApproval = async () => {
          approval.setRegistry(registryState(names.slice(0, -2)));
          await approval.invoke("platforms", 1);
          approval.setRegistry(registryState(names.slice(0, -1)));
          await approval.invoke("platforms");
          await approval.invoke("promote", 1);
          assert.deepEqual(approval.calls("npm", "dist-tag"), []);
        };

        const checkIntegrity = async () => {
          integrity.setRegistry(registryState());
          const { stderr } = await integrity.invoke("promote", 1, {
            WRONG_INTEGRITY: main
          });
          assert.match(stderr, /does not have the release tarball integrity/u);
          assert.deepEqual(integrity.calls("npm", "dist-tag"), []);
          await integrity.invoke("release", 1);
          assert.deepEqual(integrity.calls("gh"), []);
          assert.deepEqual(integrity.calls("env"), []);
        };

        const checkFinalization = async () => {
          setRegistry(registryState());
          await invoke("promote");
          assert.deepEqual(
            calls("npm", "dist-tag", "add").map((call) => call.slice(3, 5)),
            names.flatMap((name) => [
              [`${name}@${version}`, tools],
              [`${name}@${version}`, "latest"]
            ])
          );
          await invoke("release", 42, { FAIL_SMOKE: "1" });
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
          await invoke("release", 1, { MOVED_TAG: "mismatch" });
          assert.deepEqual(smokeCalls(), [smoke, smoke]);
          assert.deepEqual(calls("gh"), []);
          await invoke("release");
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
        };

        await finishAll([
          checkApproval(),
          checkIntegrity(),
          checkFinalization()
        ]);
      });

      void test("an older approval cannot move either consumer alias", async () => {
        const { calls, invoke, setRegistry, workspace } = scenario();
        await invoke("stage");
        /** @param {string} alias Dist-tag to protect. */
        const rejectsOlderApproval = async (alias) => {
          const state = registryState();
          state[main][alias] = "1.7.4-2026.12.12.10";
          setRegistry(state);
          const { stderr } = await invoke("promote", 1);
          assert.match(stderr, /Cannot use/u);
          assert.deepEqual(
            JSON.parse(
              readFileSync(path.join(workspace, "registry.json"), "utf-8")
            ),
            state
          );
        };
        await rejectsOlderApproval("latest");
        await rejectsOlderApproval(tools);
        assert.deepEqual(calls("npm", "dist-tag"), []);
      });

      void test("blocks another promotion or finalization during an alias write", async () => {
        const { artifacts, calls, invoke, setRegistry, workspace } = scenario();
        await invoke("stage");
        setRegistry(registryState());
        const otherArtifacts = path.join(workspace, "other artifacts");
        cpSync(artifacts, otherArtifacts, { recursive: true });
        const promoted = await invoke("promote", 0, {
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
        await invoke("release");
      });
    }
  );
} finally {
  rmSync(root, { force: true, recursive: true });
}
