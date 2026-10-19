import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameworkHealth } from "../src/framework-health.js";
import { catalogHealth, ensureAction, ensureLocator } from "../src/catalog.js";
import { fixtureProject, fixtureInventory } from "./intake-fixtures.js";
import {
  discover,
  materialize,
  reviewIntake,
  Recipe,
  preflight,
} from "../src/intake.js";
import { createServer } from "node:http";
import { createAdapters } from "../src/adapters.js";
import { run } from "../src/runner.js";

test("framework diagnostics detect lock drift without upgrades and catalog insertion is shared and idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-framework-"));
  try {
    await writeFile(
      join(dir, "package-lock.json"),
      JSON.stringify({
        packages: { "node_modules/@playwright/test": { version: "0.0.0" } },
      }),
    );
    const p = fixtureProject(),
      action = ensureAction(p, "web", "journey", "Web"),
      locator = ensureLocator(p, { strategy: "label", value: "Email" });
    assert.equal(
      ensureAction(p, "web", "journey", "Different description"),
      action,
    );
    assert.equal(
      ensureLocator(p, { strategy: "label", value: "Email" }),
      locator,
    );
    const before = JSON.stringify(p),
      report = await frameworkHealth(p, dir);
    assert.equal(report.packages[0]!.status, "version-drift");
    assert.ok(
      report.packages.find((x) => x.name === "@modelcontextprotocol/sdk")!
        .installed,
    );
    assert.equal(report.browsers[0]!.status, "binary-present");
    assert.equal(report.nodeSupported, true);
    assert.equal(JSON.stringify(p), before);
    assert.deepEqual(catalogHealth(p).unusedActions, [action]);
    assert.deepEqual(catalogHealth(p).unusedLocators, [locator]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("documented criteria can generate drafts with no repo, inventory or tests; empty manual cases are enhanced in place", () => {
  const p = fixtureProject();
  p.evidence = [
    {
      id: "EV",
      source: "Business spec",
      revision: "1",
      excerpt: "Health page shows Ready",
    },
  ];
  p.requirements = [
    {
      id: "REQ",
      title: "Health",
      risk: "high",
      criteria: [{ id: "AC", title: "Ready is shown" }],
      evidenceIds: ["EV"],
    },
  ];
  let plan = discover(p, "test", "web");
  assert.equal(plan.mode, "requirements");
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0]!.requirementId, "REQ");
  plan.candidates[0]!.recipe = {
    kind: "web",
    commands: [
      { type: "goto", path: "/" },
      {
        type: "expectText",
        locator: { strategy: "text", value: "Ready" },
        value: "Ready",
      },
    ],
  };
  reviewIntake(plan, p, "QE");
  const generated = materialize(p, plan);
  assert.equal(generated.requirements.length, 1);
  assert.equal(generated.evidence.length, 1);
  assert.deepEqual(generated.tests[0]!.covers, { REQ: ["AC"] });
  const manual = structuredClone(generated.tests[0]!);
  manual.id = "MANUAL-1";
  manual.steps = [];
  manual.data = { region: "east" };
  p.tests = [manual];
  const imported = fixtureInventory();
  imported.cases[0]!.title = manual.title;
  plan = discover(p, "test", "web", imported);
  assert.equal(plan.candidates[0]!.targetTestId, "MANUAL-1");
  assert.equal(plan.candidates[0]!.selected, true);
  plan.candidates[0]!.recipe = {
    kind: "web",
    commands: [
      { type: "goto", path: "/" },
      { type: "expectVisible", locator: { strategy: "text", value: "Ready" } },
    ],
  };
  assert.equal(preflight(p, plan).length, 0);
  reviewIntake(plan, p, "QE", imported);
  const enhanced = materialize(p, plan);
  assert.equal(enhanced.tests.length, 1);
  assert.equal(enhanced.tests[0]!.id, "MANUAL-1");
  assert.deepEqual(enhanced.tests[0]!.data, { region: "east" });
  assert.equal(enhanced.tests[0]!.status, "draft");
  assert.ok(
    enhanced.evidence.some(
      (e) =>
        e.source === "ADO#1" &&
        e.revision === "4" &&
        enhanced.tests[0]!.evidenceIds.includes(e.id),
    ),
  );
  assert.equal(p.tests[0]!.steps.length, 0);
});
test("native Playwright form interactions and URL/value/visibility/count assertions execute with typed checkpoints", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      '<label>Email<input name="email"></label><label>Region<select aria-label="Region"><option value="east">East</option><option value="west">West</option></select></label><label><input type="checkbox">Terms</label><button onclick="document.querySelector(\'p\').textContent=\'Confirmed\'">Submit</button><p role="status">Ready</p>',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const p = fixtureProject(url),
    inventory = fixtureInventory(),
    plan = discover(p, "test", "web", inventory);
  plan.candidates[0]!.recipe = Recipe.parse({
    kind: "web",
    commands: [
      { type: "goto", path: "/" },
      {
        type: "fill",
        locator: { strategy: "label", value: "Email" },
        value: "qe@example.invalid",
      },
      {
        type: "expectValue",
        locator: { strategy: "label", value: "Email" },
        value: "qe@example.invalid",
      },
      {
        type: "selectOption",
        locator: { strategy: "label", value: "Region" },
        value: "west",
      },
      {
        type: "expectValue",
        locator: { strategy: "label", value: "Region" },
        value: "west",
      },
      { type: "check", locator: { strategy: "label", value: "Terms" } },
      { type: "uncheck", locator: { strategy: "label", value: "Terms" } },
      {
        type: "expectCount",
        locator: { strategy: "role", value: "button" },
        count: 1,
      },
      {
        type: "expectVisible",
        locator: { strategy: "role", value: "button", name: "Submit" },
      },
      { type: "expectURL", path: "/" },
      {
        type: "click",
        locator: { strategy: "role", value: "button", name: "Submit" },
      },
      {
        type: "expectText",
        locator: { strategy: "role", value: "status" },
        value: "Confirmed",
      },
    ],
  });
  reviewIntake(plan, p, "QE", inventory);
  const built = materialize(p, plan);
  built.tests[0]!.status = "approved";
  const adapters = createAdapters();
  try {
    const result = (await run(built, "test", "intake", adapters.registry))[0]!;
    assert.equal(result.status, "passed", JSON.stringify(result));
    assert.equal(result.healed, false);
    assert.equal(
      result.observations!.filter((o) => o.operation === "assert").length,
      6,
    );
  } finally {
    await adapters.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
