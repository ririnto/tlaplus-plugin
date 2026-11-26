import assert from "node:assert/strict";
import { test } from "node:test";

import { chromium } from "playwright";

const viewer = new URL(
  "../src/main/resources/viewer/behavior.html",
  import.meta.url
);
const sequence = `<< ${Array.from({ length: 50 }, (_, index) => index + 1).join(",\n   ")} >>`;

const initialViolation = {
  exitCode: 12,
  failed: true,
  stdout: `@!@!@STARTMSG 2107:1 @!@!@
Invariant Safety is violated by the initial state:
x = ${sequence}

@!@!@ENDMSG 2107 @!@!@
`
};

const sampledBehavior = {
  exitCode: 0,
  failed: false,
  behavior: String.raw`---- MODULE behavior_0_0 ----
STATE_1 ==
/\ x = ${sequence}
/\ z = 0

STATE_2 ==
/\ x = ${sequence}
/\ z = 1

====
`
};

const numberedCounterexample = {
  exitCode: 12,
  failed: true,
  stdout: String.raw`@!@!@STARTMSG 2217:4 @!@!@
1: <Initial predicate>
/\ x = ${sequence}
/\ z = 0

@!@!@ENDMSG 2217 @!@!@
@!@!@STARTMSG 2217:4 @!@!@
2: <Next>
/\ x = ${sequence}
/\ z = 1

@!@!@ENDMSG 2217 @!@!@
`
};

const cases = [
  {
    name: "an initial invariant violation",
    result: initialViolation,
    heading: "Counterexample",
    states: 1
  },
  {
    name: "a sampled behavior",
    result: sampledBehavior,
    heading: "Sampled behavior",
    states: 2
  },
  {
    name: "a numbered counterexample",
    result: numberedCounterexample,
    heading: "Counterexample",
    states: 2
  }
];

await Promise.all(
  cases.map(async ({ name, result, heading, states }) => {
    await test(`imports the complete multiline value in ${name}`, async () => {
      await using browser = await chromium.launch();
      const page = await browser.newPage({ offline: true });
      await page.goto(viewer.href);
      await page.getByLabel("TLC result (.json)").setInputFiles({
        buffer: Buffer.from(
          JSON.stringify({
            signal: null,
            stdout: "",
            stderr: "",
            truncated: false,
            ...result
          })
        ),
        mimeType: "application/json",
        name: "result.json"
      });

      assert.equal(
        await page.getByRole("heading", { level: 2 }).textContent(),
        heading
      );
      const rows = page
        .getByRole("table", { name: "Variable values" })
        .getByRole("row");
      const x = rows.filter({
        has: page.getByRole("rowheader", { name: "x", exact: true })
      });
      assert.equal(await x.getByRole("cell").last().textContent(), sequence);
      if (states === 2) {
        await page.getByRole("button", { name: "Next", exact: true }).click();
        assert.deepEqual(await x.getByRole("cell").allTextContents(), [
          sequence,
          sequence
        ]);
        const z = rows.filter({
          has: page.getByRole("rowheader", { name: /^z/u })
        });
        assert.deepEqual(await z.getByRole("cell").allTextContents(), [
          "0",
          "1"
        ]);
      }
    });
  })
);
