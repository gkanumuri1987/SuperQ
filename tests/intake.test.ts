import test from "node:test";
import assert from "node:assert/strict";
import {
  discover,
  preflight,
  reviewIntake,
  materialize,
  assertReviewed,
  planDigest,
  Recipe,
} from "../src/intake.js";
import { projectFingerprint } from "../src/identity.js";
import {
  fixtureProject,
  fixtureInventory,
  fixtureSnapshot,
  webRecipe,
} from "./intake-fixtures.js";
test("all three starting points use actual source evidence; a URL alone supplies no knowledge", () => {
  const p = fixtureProject(),
    inventory = fixtureInventory(),
    snapshot = fixtureSnapshot();
  assert.throws(() => discover(p, "test", "api"), /Scan committed/);
  assert.equal(
    discover(p, "test", "api", undefined, snapshot).mode,
    "repository",
  );
  assert.equal(discover(p, "test", "web", inventory).mode, "inventory");
  assert.equal(
    discover(p, "test", "api", inventory, snapshot).mode,
    "combined",
  );
  const repo = discover(p, "test", "api", undefined, snapshot);
  assert.equal(repo.candidates.length, 1);
  assert.equal(repo.candidates[0]!.evidence[0]!.revision, snapshot.revision);
  assert.equal(repo.candidates[0]!.recipe?.kind, "api");
  assert.equal(preflight(p, repo).length, 0);
  assert.throws(() => assertReviewed(repo, p, undefined, snapshot), /human/);
});
test("human-reviewed plan generates reusable drafts; changed evidence, environment and mapping invalidate approval", () => {
  const p = fixtureProject(),
    snapshot = fixtureSnapshot();
  const plan = discover(p, "test", "api", undefined, snapshot);
  reviewIntake(plan, p, "Fixture QE", undefined, snapshot);
  assertReviewed(plan, p, undefined, snapshot);
  const built = materialize(p, plan);
  assert.equal(built.tests[0]!.status, "draft");
  assert.equal(built.tests[0]!.review, undefined);
  assert.equal(built.tests[0]!.steps[0]!.assertions.length, 2);
  plan.generated = {
    testIds: built.tests.map((t) => t.id),
    project: projectFingerprint(built),
  };
  assertReviewed(plan, built, undefined, snapshot);
  assert.throws(() => materialize(built, plan), /already generated/);
  const changed = structuredClone(built);
  changed.environments.test!.baseURL = "http://localhost:2/";
  assert.throws(
    () => assertReviewed(plan, changed, undefined, snapshot),
    /changed/,
  );
  const sourceChanged = structuredClone(snapshot);
  sourceChanged.revision = "b".repeat(40);
  assert.throws(
    () => assertReviewed(plan, built, undefined, sourceChanged),
    /changed/,
  );
  plan.candidates[0]!.title = "Unreviewed title";
  assert.notEqual(plan.review!.digest, planDigest(plan));
  assert.throws(
    () => assertReviewed(plan, built, undefined, snapshot),
    /human/,
  );
});
test("inventory-only intake exposes missing mappings, data and prerequisites without inventing locators", () => {
  const p = fixtureProject(),
    inventory = fixtureInventory();
  inventory.cases[0]!.dependsOn = ["ADO:missing"];
  const plan = discover(p, "test", "web", inventory),
    c = plan.candidates[0]!;
  assert.equal(c.recipe, undefined);
  assert.equal(preflight(p, plan)[0]!.kind, "mapping");
  c.recipe = webRecipe();
  assert.equal(preflight(p, plan)[0]!.kind, "dependency");
  c.dependsOn = [];
  if (c.recipe.kind === "web")
    c.recipe.commands.push({
      type: "fill",
      locator: { strategy: "label", value: "Email" },
      value: "${email}",
    });
  assert.equal(preflight(p, plan)[0]!.kind, "data");
  p.environments.test!.data.email = "qe@example.invalid";
  assert.equal(preflight(p, plan).length, 0);
});
test("deprecated, retired, out-of-sprint and unknown features are triaged and cannot be selected silently", () => {
  const inventory = fixtureInventory();
  inventory.features[0]!.lifecycle = "retired";
  let plan = discover(fixtureProject(), "test", "web", inventory);
  assert.equal(plan.candidates[0]!.disposition, "obsolete-candidate");
  assert.equal(plan.candidates[0]!.selected, false);
  plan.candidates[0]!.selected = true;
  assert.equal(preflight(fixtureProject(), plan)[0]!.kind, "scope");
  inventory.features[0]!.lifecycle = "deprecated";
  assert.equal(
    discover(fixtureProject(), "test", "web", inventory).candidates[0]!
      .disposition,
    "deprecated-review",
  );
  inventory.features = [];
  assert.equal(
    discover(fixtureProject(), "test", "web", inventory).candidates[0]!
      .disposition,
    "needs-context",
  );
});
test("source security/parameters are blockers, and existing automation is reused instead of duplicated", () => {
  const p = fixtureProject(),
    snapshot = fixtureSnapshot();
  const doc = JSON.parse(snapshot.files[0]!.content);
  doc.paths["/api/health"].get.security = [{ oauth: [] }];
  snapshot.files[0]!.content = JSON.stringify(doc);
  assert.equal(
    discover(p, "test", "api", undefined, snapshot).candidates[0]!.recipe,
    undefined,
  );
  const first = discover(p, "test", "api", undefined, fixtureSnapshot());
  reviewIntake(first, p, "QE", undefined, fixtureSnapshot());
  const built = materialize(p, first);
  const next = discover(built, "test", "api", undefined, fixtureSnapshot());
  assert.equal(next.candidates[0]!.selected, false);
  assert.deepEqual(next.candidates[0]!.existingTestIds, [built.tests[0]!.id]);
});
test("web mappings reuse locator and action definitions; dependency cycles and foreign URLs fail closed", () => {
  const p = fixtureProject(),
    inventory = fixtureInventory();
  inventory.cases.push({
    ...structuredClone(inventory.cases[0]!),
    externalId: "2",
    title: "Second flow",
  });
  const plan = discover(p, "test", "web", inventory);
  plan.candidates.forEach((c, i) => {
    c.recipe = webRecipe();
    if (i && c.recipe.kind === "web")
      c.recipe.commands[0] = { type: "goto", path: "/second" };
  });
  const built = materialize(p, plan);
  assert.equal(built.catalog.length, 1);
  assert.equal(Object.keys(built.locators).length, 1);
  plan.candidates[0]!.dependsOn = [plan.candidates[1]!.id];
  plan.candidates[1]!.dependsOn = [plan.candidates[0]!.id];
  assert.ok(preflight(p, plan).some((b) => /cycle/.test(b.detail)));
  assert.throws(() =>
    Recipe.parse({
      kind: "web",
      commands: [{ type: "goto", path: "https://other.invalid/" }],
    }),
  );
  assert.throws(() =>
    Recipe.parse({
      kind: "web",
      commands: [
        { type: "goto", path: "/" },
        { type: "click", locator: { strategy: "text", value: "Pay" } },
      ],
    }),
  );
});
test("agent-generated scenarios require exact current source citations and human confirmation", async () => {
  const { proposeCase } = await import("../src/intake.js");
  const p = fixtureProject(),
    snapshot = fixtureSnapshot();
  const plan = discover(p, "test", "api", undefined, snapshot);
  const proposal = {
    title: "Additional health scenario",
    evidence: [
      {
        source: "openapi.json",
        revision: snapshot.revision,
        excerpt: '"status":"ok"',
      },
    ],
    steps: [{ action: "Request service health", expected: "status ok" }],
  };
  proposeCase(plan, p, proposal, undefined, snapshot);
  assert.equal(plan.candidates.length, 2);
  assert.equal(plan.review, undefined);
  assert.match(plan.candidates[1]!.questions[0]!, /not correctness/);
  assert.throws(
    () =>
      proposeCase(
        plan,
        p,
        {
          ...proposal,
          title: "Invented citation",
          evidence: [
            {
              ...proposal.evidence[0],
              excerpt: "Status always means production ready",
            },
          ],
        },
        undefined,
        snapshot,
      ),
    /exact excerpt/,
  );
  assert.throws(
    () => proposeCase(plan, p, proposal, undefined, snapshot),
    /already has this title/,
  );
});
test("manual origin and explicit environment accounts survive mapping; identical proposals remain blockers", () => {
  const p = fixtureProject(),
    inventory = fixtureInventory();
  p.roles = { buyer: { description: "Buyer" } };
  p.environments.test!.users = {
    first: { role: "buyer" },
    second: { role: "buyer" },
  };
  const plan = discover(p, "test", "web", inventory),
    c = plan.candidates[0]!;
  c.recipe = webRecipe();
  c.role = "buyer";
  assert.equal(preflight(p, plan)[0]!.kind, "account");
  c.user = "second";
  assert.equal(preflight(p, plan).length, 0);
  const built = materialize(p, plan);
  assert.equal(built.tests[0]!.user, "second");
  assert.equal(built.tests[0]!.origin, "qe");
  plan.candidates.push({
    ...structuredClone(c),
    id: "SQ-I-another",
    title: "Same action different title",
  });
  assert.equal(preflight(p, plan)[0]!.kind, "duplicate");
});
