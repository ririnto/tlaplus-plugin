import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  behaviorLimit,
  behaviorPrefix,
  readBehavior
} from "../src/behavior.mts";
import { javaArguments } from "../src/runner.mts";

await test("behavior reads only a bounded regular owned file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "behavior-test-"));
  const file = `${behaviorPrefix(directory)}_0_0`;
  try {
    await assert.rejects(readBehavior(directory));
    await writeFile(file, "STATE_1 == x = 0\n");
    assert.equal(await readBehavior(directory), "STATE_1 == x = 0\n");
    await writeFile(file, "");
    await assert.rejects(readBehavior(directory), /nonempty/u);
    await writeFile(file, Buffer.alloc(behaviorLimit + 1));
    await assert.rejects(readBehavior(directory), /2 MiB/u);
    await rm(file);
    const target = path.join(directory, "target");
    await writeFile(target, "not the trace");
    await symlink(target, file);
    await assert.rejects(readBehavior(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("explore reserves trace ownership options, including equals variants", () => {
  for (const option of [
    "simulate",
    "modelcheck",
    "workers",
    "depth",
    "metadir",
    "cleanup",
    "recover",
    "help",
    "h"
  ]) {
    for (const spelling of [`-${option}`, `-${option}=2`, `--${option}`]) {
      assert.throws(
        () =>
          javaArguments(
            "tlaplus_mcp_tlc_explore",
            {
              fileName: "/tmp/Finite.tla",
              extraOpts: [spelling]
            },
            "/tmp/meta"
          ),
        /Explore owns/u
      );
    }
  }
  const args = javaArguments(
    "tlaplus_mcp_tlc_explore",
    {
      fileName: "/tmp/Finite.tla",
      extraOpts: ["-seed", "123", "-tool", "-deadlock"]
    },
    "/tmp/meta"
  );
  assert.ok(args.includes(`num=1,file=${behaviorPrefix("/tmp/meta")}`));
  assert.ok(args.includes("123"));
  assert.doesNotThrow(() =>
    javaArguments(
      "tlaplus_mcp_tlc_check",
      {
        fileName: "/tmp/Finite.tla",
        extraOpts: ["-workers", "2"]
      },
      "/tmp/meta"
    )
  );
});
