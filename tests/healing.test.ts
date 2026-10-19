import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fixtureInventory, fixtureProject } from "./intake-fixtures.js";
import { discover, materialize, reviewIntake } from "../src/intake.js";
import { ensureAction, ensureLocator } from "../src/catalog.js";
import { createAdapters } from "../src/adapters.js";
import { run, Registry } from "../src/runner.js";
import { stageRepair } from "../src/healing.js";
import { projectFingerprint, reviewFingerprint } from "../src/identity.js";
import { coverage } from "../src/coverage.js";
import { createReport, junit } from "../src/reporting.js";
import { validateProject } from "../src/model.js";
const serverFixture = async () => {
  let content =
    '<button data-testid="new-submit" onclick="document.querySelector(\'p\').textContent=\'Confirmed\'">Submit</button><p role="status">Ready</p>';
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(content);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
    set: (html: string) => {
      content = html;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
};
function healingProject(url: string) {
  const project = fixtureProject(url);
  const inventory = fixtureInventory();
  inventory.cases[0]!.steps = [
    { action: "Click Submit", expected: "Confirmed" },
  ];
  const plan = discover(project, "test", "web", inventory);
  plan.candidates[0]!.recipe = {
    kind: "web",
    commands: [
      { type: "goto", path: "/" },
      { type: "click", locator: { strategy: "testId", value: "old-submit" } },
      {
        type: "expectText",
        locator: { strategy: "role", value: "status" },
        value: "Confirmed",
      },
    ],
  };
  reviewIntake(plan, project, "QE", inventory);
  const p = materialize(project, plan);
  const original = Object.keys(p.locators).find(
    (id) => p.locators[id]!.value === "old-submit",
  )!;
  const replacement = ensureLocator(p, {
    strategy: "testId",
    value: "new-submit",
  });
  p.healing = {
    enabled: true,
    waitMs: 50,
    locators: { [original]: [replacement] },
  };
  p.tests[0]!.status = "approved";
  p.tests[0]!.review = {
    reviewer: "QE",
    at: new Date().toISOString(),
    digest: reviewFingerprint(p, p.tests[0]!),
  };
  return { p, original, replacement };
}
test("bounded catalog healing retains the failure, cannot supply release proof, and stages an assertion-preserving draft for clean rerun", async () => {
  const app = await serverFixture(),
    { p, original, replacement } = healingProject(app.url),
    adapters = createAdapters();
  try {
    const before = JSON.stringify(p),
      result = (await run(p, "test", "intake", adapters.registry))[0]!;
    assert.equal(result.status, "passed");
    assert.equal(result.healed, true);
    assert.equal(JSON.stringify(p), before);
    assert.ok(
      result.observations!.some(
        (o) => o.status === "failed" && o.issue === "control-unavailable",
      ),
    );
    assert.equal(coverage(p, [result]).riskWeightedProven, 0);
    const report = createReport(p, "test", "intake", [
      {
        profile: "local",
        provider: "local",
        browser: "chromium",
        results: [result],
      },
    ]);
    assert.equal(report.summary.healed, 1);
    assert.ok(report.gates.some((g) => g.includes("Healed execution")));
    assert.match(junit(report), /Speculative healing requires/);
    const index = result.observations!.findIndex(
      (o) => o.operation === "web.heal",
    );
    assert.equal(result.observations![index]!.replacement, replacement);
    assert.throws(
      () => stageRepair(p, result, "stale", index),
      /Project changed/,
    );
    const repaired = stageRepair(p, result, projectFingerprint(p), index);
    assert.equal(repaired.tests[0]!.status, "draft");
    assert.equal(repaired.tests[0]!.review, undefined);
    assert.deepEqual(
      repaired.tests[0]!.steps.map((s) => s.assertions),
      p.tests[0]!.steps.map((s) => s.assertions),
    );
    assert.equal(
      (
        repaired.tests[0]!.steps[0]!.input.commands as { locator?: string }[]
      )[1]!.locator,
      replacement,
    );
    repaired.tests[0]!.status = "approved";
    repaired.tests[0]!.review = {
      reviewer: "QE repair review",
      at: new Date().toISOString(),
      digest: reviewFingerprint(repaired, repaired.tests[0]!),
    };
    const clean = (
      await run(repaired, "test", "intake", adapters.registry)
    )[0]!;
    assert.equal(clean.status, "passed");
    assert.equal(clean.healed, false);
    assert.equal(coverage(repaired, [clean]).riskWeightedProven, 1);
    assert.ok(!JSON.stringify(result).includes("Confirmed"));
    assert.ok(!JSON.stringify(result).includes("new-submit"));
    assert.notEqual(original, replacement);
    // Legacy quick tests assert text by locator ID rather than checkpoint index.
    const legacy = structuredClone(p);
    legacy.tests[0]!.steps[0]!.input.commands = [
      { type: "goto", path: "/" },
      { type: "expectText", locator: original, value: "Submit" },
    ];
    legacy.tests[0]!.steps[0]!.assertions = [
      { path: `text.${original}`, operator: "equals", expected: "Submit" },
    ];
    const legacyResult = (
      await run(legacy, "test", "intake", adapters.registry)
    )[0]!;
    assert.equal(legacyResult.healed, true);
    assert.equal(legacyResult.status, "passed");
    const legacyRepair = stageRepair(
      legacy,
      legacyResult,
      projectFingerprint(legacy),
      legacyResult.observations!.findIndex((o) => o.operation === "web.heal"),
    );
    assert.equal(
      (
        legacyRepair.tests[0]!.steps[0]!.input.commands as Record<
          string,
          unknown
        >[]
      )[1]!.captureAs,
      original,
    );
    legacyRepair.tests[0]!.status = "approved";
    const legacyClean = (
      await run(legacyRepair, "test", "intake", adapters.registry)
    )[0]!;
    assert.equal(legacyClean.status, "passed");
    assert.equal(legacyClean.healed, false);
  } finally {
    await adapters.close();
    await app.close();
  }
});
test("an assertion failure is never healed; ambiguous alternative controls are refused", async () => {
  const app = await serverFixture(),
    { p, original, replacement } = healingProject(app.url),
    adapters = createAdapters();
  try {
    app.set(
      '<button data-testid="old-submit" onclick="document.querySelector(\'p\').textContent=\'Rejected\'">Submit</button><button data-testid="new-submit">Other</button><p role="status">Ready</p>',
    );
    (
      p.tests[0]!.steps[0]!.input.commands as Record<string, unknown>[]
    )[2]!.timeoutMs = 100;
    let result = (await run(p, "test", "intake", adapters.registry))[0]!;
    assert.equal(result.status, "failed");
    assert.equal(result.healed, false);
    assert.equal(result.observations!.at(-1)!.issue, "expectation-failed");
    app.set(
      '<button data-testid="new-submit">First</button><button data-testid="new-submit">Second</button><p role="status">Confirmed</p>',
    );
    p.execution.stepTimeoutMs = 2000;
    result = (await run(p, "test", "intake", adapters.registry))[0]!;
    assert.equal(result.status, "failed");
    assert.equal(result.healed, false);
    assert.ok(
      result.observations!.some(
        (o) =>
          o.operation === "web.heal" &&
          o.status === "failed" &&
          o.issue === "ambiguous-control",
      ),
    );
    const second = ensureLocator(p, {
      strategy: "testId",
      value: "other-submit",
    });
    p.healing!.locators[original] = [replacement, second];
    app.set(
      '<button data-testid="new-submit">First</button><button data-testid="other-submit">Second</button><p role="status">Confirmed</p>',
    );
    result = (await run(p, "test", "intake", adapters.registry))[0]!;
    assert.equal(result.status, "failed");
    assert.equal(result.healed, false);
    assert.ok(
      result.observations!.some(
        (o) => o.operation === "web.heal" && o.issue === "ambiguous-control",
      ),
    );
    assert.throws(
      () =>
        validateProject({
          ...p,
          healing: {
            ...p.healing,
            locators: { [original]: [replacement, replacement] },
          },
        }),
      /distinct existing/,
    );
  } finally {
    await adapters.close();
    await app.close();
  }
});
test("healing flags survive bounded observation truncation", async () => {
  const { p } = healingProject("http://127.0.0.1:1/");
  p.catalog = [
    {
      id: "owned",
      kind: "custom",
      operation: "trace",
      description: "Trusted test fixture",
    },
  ];
  p.tests[0]!.steps = [
    {
      action: "owned",
      input: {},
      save: {},
      assertions: [{ path: "ok", operator: "equals", expected: true }],
    },
  ];
  const registry = new Registry().register(
    "custom:trace",
    async (_input, ctx) => {
      for (let n = 0; n < 1100; n++)
        ctx.observe?.({ operation: "owned", status: "passed" });
      ctx.observe?.({
        operation: "web.heal",
        status: "passed",
        locator: "old",
        replacement: "new",
      });
      return { ok: true };
    },
  );
  const result = (await run(p, "test", "intake", registry))[0]!;
  assert.equal(result.healed, true);
  assert.equal(result.diagnosticsTruncated, true);
  assert.equal(result.observations!.length, 1000);
});
