import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

await test("reports literal defaults only for actions with approved exact-ref metadata", (context) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "workflow-inputs-"));
  context.after(() => {
    rmSync(cwd, { force: true, recursive: true });
  });
  const file = path.join(".github", "workflows", "probe.yml");
  mkdirSync(path.join(cwd, ".github", "workflows"), { recursive: true });
  const script = fileURLToPath(
    new URL("../scripts/check-workflow-inputs.ts", import.meta.url)
  );
  const controls = `jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          clean: false
          fetch-depth: "\${{ 1 }}"
          repository: "\${{ github.repository }}"
          persist-credentials: false
          path: ""
      - uses: actions/setup-node@v7
        with:
          package-manager-cache: true
      - uses: actions/checkout@v6
        with:
          clean: true
      - uses: example/checkout@v7
        with:
          clean: true
`;
  writeFileSync(path.join(cwd, file), controls);
  const passing = spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf-8"
  });
  assert.equal(passing.status, 0, passing.stderr);
  assert.equal(passing.stderr, "");

  writeFileSync(
    path.join(cwd, file),
    `${controls}      - uses: actions/checkout@v7
        with:
          clean: true
          fetch-depth: 1
          ssh-user: git
`
  );
  const failing = spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf-8"
  });
  assert.equal(failing.status, 1, failing.stderr);
  assert.deepEqual(failing.stderr.trim().split("\n"), [
    `${file}:23:11: R35 Remove clean from actions/checkout@v7 with inputs. Its documented default is "true".`,
    `${file}:24:11: R35 Remove fetch-depth from actions/checkout@v7 with inputs. Its documented default is "1".`,
    `${file}:25:11: R35 Remove ssh-user from actions/checkout@v7 with inputs. Its documented default is "git".`
  ]);
});
