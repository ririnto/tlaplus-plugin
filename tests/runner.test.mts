import assert from "node:assert/strict";
import { test } from "node:test";

import { javaArguments, toolNames } from "../src/runner.mts";

await test("tool names match AgentSkills contract", () => {
  assert.deepEqual(toolNames, [
    "tlaplus_mcp_sany_parse",
    "tlaplus_mcp_tlc_check",
    "tlaplus_mcp_tlc_smoke",
    "tlaplus_mcp_tlc_explore"
  ]);
});
await test("fileName must be absolute", () => {
  assert.throws(
    () =>
      javaArguments(
        "tlaplus_mcp_sany_parse",
        { fileName: "Counter.tla" },
        "/tmp/meta"
      ),
    /absolute/u
  );
});
await test("SANY preserves a path with spaces as one argument", () => {
  const args = javaArguments(
    "tlaplus_mcp_sany_parse",
    { fileName: "/tmp/my model/Counter.tla" },
    "/tmp/meta"
  );
  assert.deepEqual(args.slice(-2), [
    "tla2sany.SANY",
    "/tmp/my model/Counter.tla"
  ]);
});
await test("TLC arguments preserve JVM, config and model options", () => {
  const args = javaArguments(
    "tlaplus_mcp_tlc_check",
    {
      fileName: "/tmp/Counter.tla",
      cfgFile: "/tmp/Counter.cfg",
      extraJavaOpts: ["-Xmx512m"],
      extraOpts: ["-deadlock"]
    },
    "/tmp/meta"
  );
  assert.equal(args[0], "-Xmx512m");
  assert.equal(args.includes("-simulate"), false);
  assert.deepEqual(args.slice(-4), [
    "-config",
    "/tmp/Counter.cfg",
    "-deadlock",
    "Counter.tla"
  ]);
});
await test("smoke and explore are bounded simulations", () => {
  const smoke = javaArguments(
    "tlaplus_mcp_tlc_smoke",
    { fileName: "/tmp/Counter.tla" },
    "/tmp/meta"
  );
  const explore = javaArguments(
    "tlaplus_mcp_tlc_explore",
    { fileName: "/tmp/Counter.tla", behaviorLength: 7 },
    "/tmp/meta"
  );
  assert.deepEqual(smoke.slice(-5), [
    "-simulate",
    "num=1",
    "-depth",
    "100",
    "Counter.tla"
  ]);
  assert.equal(explore[explore.indexOf("-depth") + 1], "7");
  assert.throws(
    () =>
      javaArguments(
        "tlaplus_mcp_tlc_explore",
        { fileName: "/tmp/Counter.tla", behaviorLength: 0 },
        "/tmp/meta"
      ),
    /positive integer/u
  );
});
