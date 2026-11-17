import assert from "node:assert/strict";

export const simulationDepth = (stdout: string): number => {
  assert.match(stdout, /Running Random Simulation/u);
  const depths = [...stdout.matchAll(/TLAPLUS_DEPTH=(?<depth>\d+)/gu)].map(
    (match) => Number(match.groups?.depth)
  );
  assert.ok(depths.length > 0, "Simulation must execute fixture transitions");
  const maximum = Math.max(...depths);
  assert.ok(Number.isSafeInteger(maximum) && maximum > 0);
  assert.deepEqual(
    [...new Set(depths)].toSorted((left, right) => left - right),
    Array.from({ length: maximum }, (_, index) => index + 1)
  );
  return maximum;
};
