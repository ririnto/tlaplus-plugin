import assert from "node:assert/strict";
import { test } from "node:test";

import { simulationDepth } from "./simulation-output.mts";

await test("simulation evidence includes contiguous real transitions", () => {
  assert.equal(
    simulationDepth(
      "Running Random Simulation\nTLAPLUS_DEPTH=1\nTLAPLUS_DEPTH=2"
    ),
    2
  );
});
await test("model checking output is not simulation evidence", () => {
  assert.throws(() => simulationDepth("100 states generated\nTLAPLUS_DEPTH=1"));
});
await test("simulation banner alone is not transition evidence", () => {
  assert.throws(() => simulationDepth("Running Random Simulation"));
});
await test("missing transitions cannot establish requested depth", () => {
  assert.throws(() =>
    simulationDepth(
      "Running Random Simulation\nTLAPLUS_DEPTH=1\nTLAPLUS_DEPTH=3"
    )
  );
});
