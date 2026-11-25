import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { sync } from "cross-spawn";

const run = (args: string[], env = process.env) =>
  sync("pnpm", ["run", "lint:workflows", ...args], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf-8",
    env
  });

const identifiers = (output: string) =>
  Array.from(
    output.matchAll(
      /^(?<file>.*):(?<line>\d+):(?<column>\d+): R35 (?<reference>\S+) (?<input>\S+) \[(?<category>[\w-]+)\]/gmu
    ),
    ({ groups }) => ({
      category: groups?.category,
      column: Number(groups?.column),
      file: groups?.file,
      input: groups?.input,
      line: Number(groups?.line),
      reference: groups?.reference
    })
  );

const gitFixture = (directory: string, ...args: string[]): void => {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_DIR: undefined,
      GIT_INDEX_FILE: undefined,
      GIT_WORK_TREE: undefined
    }
  });
  assert.equal(result.status, 0, result.stderr);
};

await test("R35 compares the defaults the runner receives and protects shared inputs", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "workflow-inputs-"));
  context.after(() => {
    rmSync(directory, { force: true, recursive: true });
  });
  const file = path.join(directory, "probe.yml");
  const empty = path.join(directory, "empty.yml");
  const comments = path.join(directory, "comments.yml");
  const noJobs = path.join(directory, "no-jobs.yml");
  const noSteps = path.join(directory, "no-steps.yml");
  writeFileSync(empty, "");
  writeFileSync(comments, "# workflow comment\n");
  writeFileSync(noJobs, "name: No jobs\n");
  writeFileSync(
    noSteps,
    "jobs:\n  verify:\n    uses: ./.github/workflows/package.yaml\n"
  );
  const controls = `name: Workflow inputs
on: push
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: &checkout actions/checkout@v7
        with:
          clean: false
          fetch-depth: "\${{ 1 }}"
          repository: example/repo
          path: ""
      - uses: actions/setup-node@v7
        with:
          package-manager-cache: false
      - uses: actions/checkout@v6
        with: &shared
          clean: true
          ssh-user: &git git
      - uses: example/checkout@v7
        with: *shared
      - uses: actions/checkout@v7
        with:
          clean: "TRUE"
          fetch-depth: 1.0000000000000051
`;
  writeFileSync(file, controls);

  const passing = run([empty, comments, noJobs, noSteps, file]);
  assert.equal(passing.status, 0, passing.stderr);
  assert.equal(identifiers(passing.stderr).length, 0);

  writeFileSync(
    file,
    `${controls}      - uses: *checkout
        with: *shared
      - &step
        uses: *checkout
        with: &inputs
          CLEAN: &unused TRUE
          fetch-depth: &depth 0x1
          ssh-user: *git
          filter: null
      - *step
      - uses: actions/checkout@v6
        with:
          fetch-depth: *depth
      - uses: actions/setup-node@v7
        with:
          package-manager-cache: true
      - uses: actions/upload-artifact@v7
        with:
          archive: false
          name: artifact
          path: build/output.txt
      - uses: graalvm/setup-graalvm@v1
        with:
          distribution: ""
          version: ""
          components:
      - uses: pnpm/action-setup@v4
        with:
          dest: ~/setup-pnpm
      - uses: actions/checkout@v7
        with:
          clean: &solo true
          sparse-checkout: ~
          fetch-depth: 1.0000000000000049
`
  );
  const failing = run([empty, comments, noJobs, noSteps, file]);
  assert.equal(failing.status, 1, failing.stderr);
  const expected = [
    [27, 15, "actions/checkout@v7", "clean", "shared-definition"],
    [27, 15, "actions/checkout@v7", "ssh-user", "shared-definition"],
    [31, 11, "actions/checkout@v7", "CLEAN", "hand-edit"],
    [32, 11, "actions/checkout@v7", "fetch-depth", "hand-edit"],
    [33, 21, "actions/checkout@v7", "ssh-user", "hand-edit"],
    [34, 11, "actions/checkout@v7", "filter", "hand-edit"],
    [35, 9, "actions/checkout@v7", "CLEAN", "hand-edit"],
    [35, 9, "actions/checkout@v7", "fetch-depth", "hand-edit"],
    [35, 9, "actions/checkout@v7", "ssh-user", "hand-edit"],
    [35, 9, "actions/checkout@v7", "filter", "hand-edit"],
    [41, 11, "actions/setup-node@v7", "package-manager-cache", "omit"],
    [45, 11, "actions/upload-artifact@v7", "name", "omit"],
    [49, 11, "graalvm/setup-graalvm@v1", "distribution", "omit"],
    [50, 11, "graalvm/setup-graalvm@v1", "version", "omit"],
    [51, 11, "graalvm/setup-graalvm@v1", "components", "omit"],
    [54, 11, "pnpm/action-setup@v4", "dest", "omit"],
    [57, 11, "actions/checkout@v7", "clean", "omit"],
    [58, 11, "actions/checkout@v7", "sparse-checkout", "omit"],
    [59, 11, "actions/checkout@v7", "fetch-depth", "omit"]
  ].map(([line, column, reference, input, category]) => ({
    category,
    column,
    file,
    input,
    line,
    reference
  }));
  const diagnostics = identifiers(failing.stderr);
  assert.equal(diagnostics.length, expected.length, failing.stderr);
  assert.deepEqual(
    new Set(diagnostics.map((entry) => JSON.stringify(entry))),
    new Set(expected.map((entry) => JSON.stringify(entry)))
  );

  const listing = run(["--metadata"]);
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(
    listing.stdout,
    /\bactions\/checkout@v7 repository contextual\b/u
  );

  writeFileSync(
    file,
    `jobs:
  first:
    steps: &steps
      - &step
        &uses uses: actions/checkout@v7
        &with with: &inputs
          &clean clean: &enabled true
      - ? *uses
        : actions/checkout@v7
        ? *with
        :
          ? *clean
          : *enabled
  second:
    steps: *steps
`
  );
  const aliased = run([file]);
  assert.equal(aliased.status, 1, aliased.stderr);
  const aliasDiagnostics = identifiers(aliased.stderr);
  assert.equal(aliasDiagnostics.length, 4, aliased.stderr);
  assert.deepEqual(
    aliasDiagnostics.toSorted((first, second) => first.line - second.line),
    [
      {
        category: "hand-edit",
        column: 18,
        file,
        input: "clean",
        line: 7,
        reference: "actions/checkout@v7"
      },
      {
        category: "hand-edit",
        column: 13,
        file,
        input: "clean",
        line: 13,
        reference: "actions/checkout@v7"
      },
      {
        category: "hand-edit",
        column: 12,
        file,
        input: "clean",
        line: 15,
        reference: "actions/checkout@v7"
      },
      {
        category: "hand-edit",
        column: 12,
        file,
        input: "clean",
        line: 15,
        reference: "actions/checkout@v7"
      }
    ]
  );
  const reportedLines = new Set(
    Array.from(aliased.stderr.matchAll(/:(?<line>\d+):\d+\b/gu), ({ groups }) =>
      Number(groups?.line)
    )
  );
  assert.deepEqual(reportedLines, new Set([3, 6, 7, 10, 12, 13, 15]));
});

await test("R35 compares local action defaults only from a proven workflow revision", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "workflow-revision-"));
  context.after(() => {
    rmSync(directory, { force: true, recursive: true });
  });
  mkdirSync(path.join(directory, "local"));
  mkdirSync(path.join(directory, ".github", "workflows"), { recursive: true });
  const file = path.join(directory, ".github", "workflows", "probe.yml");
  writeFileSync(
    path.join(directory, "local", "action.yml"),
    `name: Local action
inputs:
  workflow-midpoint:
    default: 1234567890123440
  metadata-midpoint:
    default: 1234567890123445
  upper-neighbor:
    default: 1234567890123450
  radix:
    default: -1
runs:
  using: composite
  steps: []
`
  );
  writeFileSync(
    file,
    `name: Local action
on: push
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: ./local
        with:
          workflow-midpoint: 1234567890123445
          metadata-midpoint: 1234567890123440
          upper-neighbor: 1234567890123445
          radix: 0xffffffff
      - uses: ./unavailable
        with:
          mode: test
  replaced:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: another-revision
      - uses: ./local
        with:
          workflow-midpoint: 1234567890123445
  unknown:
    runs-on: ubuntu-latest
    steps:
      - run: echo arbitrary-step
      - uses: ./local
        with:
          workflow-midpoint: 1234567890123445
`
  );
  gitFixture(directory, "init", "--quiet", "--template=");
  gitFixture(directory, "add", ".");
  gitFixture(
    directory,
    "-c",
    "user.name=Workflow test",
    "-c",
    "user.email=workflow@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "Record workflow fixture"
  );
  const result = run([file], {
    ...process.env,
    GIT_DIR: path.join(directory, "unrelated.git")
  });
  assert.equal(result.status, 1, result.stderr);
  const diagnostics = identifiers(result.stderr);
  assert.equal(diagnostics.length, 3, result.stderr);
  assert.deepEqual(
    diagnostics.toSorted((first, second) => first.line - second.line),
    [
      {
        category: "omit",
        column: 11,
        file,
        input: "workflow-midpoint",
        line: 10,
        reference: "./local"
      },
      {
        category: "omit",
        column: 11,
        file,
        input: "metadata-midpoint",
        line: 11,
        reference: "./local"
      },
      {
        category: "omit",
        column: 11,
        file,
        input: "radix",
        line: 13,
        reference: "./local"
      }
    ]
  );
});
