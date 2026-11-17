import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../scripts/command.mts";

await test("command helper captures both output streams", async () => {
  const result = await run(process.execPath, [
    "-e",
    "process.stdout.write('out'); process.stderr.write('err')"
  ]);
  assert.deepEqual(result, { stdout: "out", stderr: "err" });
});
await test("command helper preserves a nonzero exit as an error", async () => {
  await assert.rejects(
    run(process.execPath, [
      "-e",
      "process.stderr.write('failed'); process.exitCode = 3"
    ]),
    /failed/u
  );
});
await test("explicit timeout terminates a process that ignores SIGTERM", async () => {
  await assert.rejects(
    run(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { timeout: 150 }
    ),
    (error: unknown) =>
      error instanceof Error && "signal" in error && error.signal === "SIGKILL"
  );
});
await test("failed command retains stdout-only diagnostics", async () => {
  await assert.rejects(
    run(process.execPath, [
      "-e",
      "process.stdout.write('diagnostic-only-on-stdout'); process.exitCode = 2"
    ]),
    (error: unknown) =>
      error instanceof Error &&
      "stdout" in error &&
      error.stdout === "diagnostic-only-on-stdout"
  );
});
