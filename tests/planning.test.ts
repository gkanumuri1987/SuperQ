import test from "node:test";
import assert from "node:assert/strict";
import { Planning, assessPlanning } from "../src/planning.js";
const evidence = {
  source: "design/orders",
  revision: "abc123",
  excerpt: "Quantity is between 1 and 10 inclusive.",
};
const feature = {
  id: "orders",
  title: "Orders",
  module: "Commerce",
  lifecycle: "active",
  evidence,
};
const manual = {
  source: "ADO",
  externalId: "1",
  revision: "2",
  title: "Order",
  featureIds: ["orders"],
  storyIds: ["S1"],
  steps: [{ action: "Submit", expected: "Created" }],
  dependsOn: [],
};
test("intake distinguishes unknown, retired and current sprint scope without mutating cases", () => {
  const input = {
    features: [feature, { ...feature, id: "old", lifecycle: "retired" }],
    stories: [
      {
        id: "S1",
        title: "Orders",
        featureIds: ["orders"],
        criteria: ["Quantity validated"],
        evidence,
      },
    ],
    cases: [
      manual,
      { ...manual, externalId: "2", featureIds: ["old"] },
      { ...manual, externalId: "3", featureIds: ["unknown"] },
    ],
  };
  const before = JSON.stringify(input),
    r = assessPlanning(input);
  assert.equal(r.triage[0]!.scope, "in-scope");
  assert.equal(r.triage[1]!.lifecycle, "obsolete-candidate");
  assert.equal(r.triage[1]!.scope, "out-of-current-sprint");
  assert.equal(r.triage[2]!.lifecycle, "needs-context");
  assert.equal(JSON.stringify(input), before);
});
test("dependency review detects missing prerequisites and cycles", () => {
  const r = assessPlanning({
    cases: [
      { ...manual, dependsOn: ["ADO:2", "missing:3"] },
      { ...manual, externalId: "2", dependsOn: ["ADO:1"] },
    ],
  });
  assert.equal(r.triage[0]!.cycle, true);
  assert.match(
    r.triage[0]!.dependencies[1]!.resolution,
    /missing prerequisite/,
  );
});
test("coverage uses supplied boundaries and retains source and unresolved expectations", () => {
  const r = assessPlanning({
    features: [feature],
    stories: [
      {
        id: "S1",
        title: "Orders",
        featureIds: ["orders"],
        criteria: ["Quantity validated"],
        evidence,
        boundaries: [
          { field: "quantity", min: 1, max: 10, increment: 1, evidence },
        ],
        integrations: [
          {
            name: "Inventory",
            contract: "Reserve before confirming",
            evidence,
          },
        ],
      },
    ],
    cases: [manual],
    documents: [
      {
        id: "ED1",
        kind: "Engineering design",
        featureIds: ["orders"],
        evidence,
      },
    ],
  });
  assert.deepEqual(r.proposals[0]!.linkedCases, ["ADO:1"]);
  assert.match(r.proposals[0]!.suggestions[2]!.intent, /0, 1, 2, 9, 10, 11/);
  assert.equal(
    r.proposals[0]!.suggestions[3]!.evidence.source,
    evidence.source,
  );
  assert.equal(r.proposals[0]!.documentReviews.length, 1);
  assert.equal(r.proposals[0]!.status, "review-required");
  assert.throws(() => Planning.parse({ cases: [manual, manual] }), /Duplicate/);
});
