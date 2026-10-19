import test from "node:test";
import assert from "node:assert/strict";
import { sampleProject, sampleCandidate } from "../src/workspace/sample.js";
import { compareProjects, stageChanges } from "../src/maintenance.js";
import { reviewFingerprint } from "../src/identity.js";
import { coverage } from "../src/coverage.js";
test("feature comparisons link source, locator and validation changes to affected tests", () => {
  const p = sampleProject(4310),
    candidate = sampleCandidate(p),
    plan = compareProjects(p, candidate);
  assert.deepEqual(
    plan.items.map((i) => i.testId),
    ["TC-101", "TC-102", "TC-106"],
  );
  assert.ok(
    plan.items
      .find((i) => i.testId === "TC-101")!
      .changes.some((c) => c.kind === "Validation"),
  );
  assert.ok(
    plan.items
      .find((i) => i.testId === "TC-102")!
      .changes.some((c) => c.kind === "UI"),
  );
  assert.ok(
    plan.items
      .find((i) => i.testId === "TC-102")!
      .changes.some((c) => c.kind === "Workflow"),
  );
  const updated = stageChanges(p, plan, [plan.items[0]!.id]);
  assert.equal(updated.tests[0]!.status, "draft");
  assert.equal(updated.tests[0]!.steps[0]!.assertions[1]!.expected, "placed");
  assert.equal(updated.locators["checkout.submit"]!.value, "submit-order");
  assert.ok(
    coverage(updated).rows[0]!.gaps.includes("uncovered-acceptance-criteria"),
  );
});
test("staging cannot overwrite test edits or unrelated new source updates", () => {
  const p = sampleProject(4310),
    plan = compareProjects(p, sampleCandidate(p));
  p.tests[0]!.title = "Changed after analysis";
  assert.throws(
    () => stageChanges(p, plan, [plan.items[0]!.id]),
    /Test changed/,
  );
  const q = sampleProject(4310);
  q.evidence[1]!.excerpt = "New unreviewed source change";
  assert.throws(
    () => stageChanges(q, plan, [plan.items[0]!.id]),
    /sources changed/,
  );
});
test("later staging preserves a review completed after shared updates were applied", () => {
  const p = sampleProject(4310),
    plan = compareProjects(p, sampleCandidate(p));
  const first = stageChanges(p, plan, [plan.items[0]!.id]);
  plan.items[0]!.status = "staged";
  first.tests[0]!.status = "approved";
  first.tests[0]!.review = {
    reviewer: "Fixture",
    at: new Date().toISOString(),
    digest: reviewFingerprint(first, first.tests[0]!),
  };
  const second = stageChanges(first, plan, [plan.items[1]!.id]);
  assert.equal(second.tests[0]!.status, "approved");
  assert.ok(second.tests[0]!.review);
  assert.equal(second.tests[1]!.status, "draft");
});
test("new behavior is visible even when it affects no previous test; removal is never silent", () => {
  const p = sampleProject(4310),
    candidate = structuredClone(p);
  candidate.requirements.push({
    id: "REQ-NEW",
    title: "New behavior",
    risk: "high",
    evidenceIds: ["SPEC-ACCOUNT"],
    criteria: [{ id: "NEW-AC", title: "An independent outcome" }],
  });
  const plan = compareProjects(p, candidate);
  assert.ok(plan.changedRequirements.includes("REQ-NEW"));
  assert.equal(plan.items.length, 0);
  assert.equal(stageChanges(p, plan, []).requirements.length, 6);
  candidate.tests.pop();
  assert.throws(() => compareProjects(p, candidate), /retirement/);
});
