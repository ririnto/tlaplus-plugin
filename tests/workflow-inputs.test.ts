import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { sync } from "cross-spawn";

await test("reports literal defaults only for actions with approved exact-ref metadata", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "workflow-inputs-"));
  context.after(() => {
    rmSync(directory, { force: true, recursive: true });
  });
  const file = path.join(directory, "probe.yml");
  const run = () =>
    sync("pnpm", ["run", "check:workflows", file], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf-8"
    });
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
          persist-credentials: false
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
      - uses: actions/upload-artifact@v7
        with:
          archive: false
          name: artifact
          path: build/output.txt
`;
  writeFileSync(file, controls);
  const passing = run();
  assert.equal(passing.status, 0, passing.stderr);
  assert.doesNotMatch(passing.stderr, /\bR35\b/u);

  writeFileSync(
    file,
    `${controls}      - uses: *checkout
        with: *shared
      - uses: *checkout
        with:
          CLEAN: true
          fetch-depth: &depth 1
          ssh-user: *git
          filter: null
      - uses: actions/checkout@v6
        with:
          fetch-depth: *depth
      - uses: actions/setup-node@v7
        with:
          package-manager-cache: true
      - uses: graalvm/setup-graalvm@v1
        with:
          components:
      - uses: graalvm/setup-graalvm@v1
        with:
          components: ""
`
  );
  const failing = run();
  assert.equal(failing.status, 1, failing.stderr);
  const diagnostics = Array.from(
    failing.stderr.matchAll(
      /^(?<location>.*:\d+:\d+): R35 (?<action>\S+) (?<input>\S+):/gmu
    ),
    ({ groups }) => `${groups?.location} ${groups?.action} ${groups?.input}`
  );
  assert.equal(diagnostics.length, 9, failing.stderr);
  assert.deepEqual(
    diagnostics.toSorted(),
    [
      `${file}:19:11 actions/checkout@v7 clean`,
      `${file}:20:11 actions/checkout@v7 ssh-user`,
      `${file}:32:11 actions/checkout@v7 CLEAN`,
      `${file}:33:11 actions/checkout@v7 fetch-depth`,
      `${file}:34:11 actions/checkout@v7 ssh-user`,
      `${file}:35:11 actions/checkout@v7 filter`,
      `${file}:41:11 actions/setup-node@v7 package-manager-cache`,
      `${file}:44:11 graalvm/setup-graalvm@v1 components`,
      `${file}:47:11 graalvm/setup-graalvm@v1 components`
    ].toSorted()
  );
});
