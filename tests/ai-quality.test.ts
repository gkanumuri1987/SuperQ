import test from "node:test";
import assert from "node:assert/strict";
import { assessProposal } from "../src/proposal-quality.js";
import {
  coordinate,
  applyCoordination,
  type Worker,
} from "../src/coordinator.js";
import { coordinationReport } from "../src/coordination-report.js";
import {
  CaseProposal,
  discover,
  proposeCase,
  preflight,
} from "../src/intake.js";
import { fixtureProject, fixtureInventory } from "./intake-fixtures.js";

const valid = () =>
  CaseProposal.parse({
    title: "Independent health contract",
    evidence: [{ source: "ED", revision: "1", excerpt: "Health shows Ready" }],
    steps: [{ action: "GET health", expected: "The service reports Ready" }],
    recipe: {
      kind: "api",
      requests: [
        {
          path: "/health",
          assertions: [
            { path: "body.status", operator: "equals", expected: "Ready" },
          ],
        },
      ],
    },
  });
const makeWorker =
  (proposal = valid()): Worker =>
  async (role) =>
    role === "analyst"
      ? {
          gaps: [{ description: "Health contract", sources: ["ED"] }],
          questions: [],
        }
      : role === "designer"
        ? { proposals: [proposal] }
        : { accepted: [0], issues: [] };
function fixture() {
  const project = fixtureProject(),
    inventory = fixtureInventory();
  return {
    project,
    inventory,
    plan: discover(project, "test", "api", inventory),
  };
}

test("AI checks reject vacuous and contradictory assertions while retaining valid empty, negative and status checks", () => {
  for (const [operator, expected] of [
    ["contains", ""],
    ["matches", ".*"],
    ["matches", "^[\\s\\S]*$"],
  ] as const) {
    const p = valid();
    if (p.recipe?.kind !== "api") throw new Error();
    p.recipe.requests[0]!.assertions = [{ path: "body", operator, expected }];
    assert.equal(assessProposal(p).status, "blocked");
  }
  const p = valid();
  if (p.recipe?.kind !== "api") throw new Error();
  p.recipe.requests[0]!.assertions.push({
    path: "body.status",
    operator: "equals",
    expected: "Down",
  });
  assert.ok(
    assessProposal(p).findings.some(
      (f) => f.code === "contradictory-assertions",
    ),
  );
  for (const expected of ["", false, 0, null]) {
    p.recipe.requests[0]!.assertions = [
      { path: "body.status", operator: "equals", expected },
    ];
    assert.equal(assessProposal(p).status, "needs-review");
  }
  p.recipe.requests[0]!.assertions = [
    { path: "status", operator: "equals", expected: 404 },
  ];
  assert.deepEqual(
    assessProposal(p).findings.map((f) => f.code),
    ["status-only"],
  );
});

test("AI checks identify renamed duplicate flows, generic expectations and unmapped cases without claiming semantic equivalence", () => {
  const p = valid();
  const duplicate = assessProposal({ ...p, title: "Renamed" }, [
    { ...p, id: "original" },
  ]);
  assert.equal(duplicate.findings[0]!.relatedCandidateId, "original");
  assert.equal(duplicate.status, "needs-review");
  p.steps[0]!.expected = "Works as expected";
  delete p.recipe;
  assert.deepEqual(
    assessProposal(p).findings.map((f) => f.code),
    ["vague-expectation", "mapping-needed"],
  );
  p.steps[0]!.action = "  ";
  assert.equal(assessProposal(p).status, "blocked");
});

test("all agent intake paths reject blank citations and bad assertions without mutating the plan", () => {
  const { project, inventory, plan } = fixture();
  const before = structuredClone(plan);
  const p = valid();
  p.evidence[0]!.excerpt = " ";
  assert.throws(
    () => proposeCase(plan, project, p, inventory),
    /Evidence excerpt/,
  );
  p.evidence[0]!.excerpt = "Health shows Ready";
  if (p.recipe?.kind !== "api") throw new Error();
  p.recipe.requests[0]!.assertions = [
    { path: "body.status", operator: "matches", expected: ".*" },
  ];
  assert.throws(
    () => proposeCase(plan, project, p, inventory),
    /Proposal quality/,
  );
  assert.deepEqual(plan, before);
});

test("deterministic rejection stops before reviewer and preserves an inspectable quality report", async () => {
  const { project, inventory, plan } = fixture(),
    p = valid(),
    roles: string[] = [];
  p.steps[0]!.expected = " ";
  const worker = makeWorker(p);
  const { job, done } = coordinate(
    project,
    plan,
    inventory,
    undefined,
    "fixture",
    async (...args) => {
      roles.push(args[0]);
      return worker(...args);
    },
  );
  await done;
  assert.equal(job.state, "failed");
  assert.equal(job.diagnostics?.failure, "proposal-quality");
  assert.equal(job.quality?.[0]?.status, "blocked");
  assert.deepEqual(roles, ["analyst", "designer"]);
  assert.throws(() => applyCoordination(job, project, plan, inventory));
  assert.equal(plan.candidates.length, 1);
});

test("each role sees the frozen source snapshot; subsequent changes make staging stale", async () => {
  const { project, inventory, plan } = fixture();
  const contexts: string[] = [];
  const worker = makeWorker();
  const { job, done } = coordinate(
    project,
    plan,
    inventory,
    undefined,
    "fixture",
    async (...args) => {
      contexts.push(JSON.stringify(JSON.parse(args[2]).context));
      if (args[0] === "analyst") {
        inventory.features[0]!.evidence.excerpt = "NEW UNREVIEWED RULE";
        plan.candidates[0]!.title = "Changed during model call";
      }
      return worker(...args);
    },
  );
  await done;
  assert.equal(job.state, "completed");
  assert.equal(new Set(contexts).size, 1);
  assert.ok(contexts.every((c) => !c.includes("NEW UNREVIEWED RULE")));
  assert.throws(
    () => applyCoordination(job, project, plan, inventory),
    /stale/,
  );
});

test("diagnostics bound worker output and distinguish schema, citation and reference failures without reflecting worker errors", async () => {
  for (const [expected, override] of [
    [
      "worker-output",
      async () => {
        throw new Error("PRIVATE-CREDENTIAL");
      },
    ],
    ["worker-output", async () => ({ payload: "PRIVATE".repeat(20000) })],
    ["schema", async () => ({ unsupported: true })],
    [
      "citations",
      async () => ({
        gaps: [{ description: "Fake", sources: ["unknown"] }],
        questions: [],
      }),
    ],
  ] as const) {
    const { project, inventory, plan } = fixture();
    const { job, done } = coordinate(
      project,
      plan,
      inventory,
      undefined,
      "fixture",
      override,
    );
    await done;
    assert.equal(job.diagnostics?.failure, expected);
    assert.ok(!JSON.stringify(coordinationReport(job)).includes("PRIVATE"));
    assert.ok(!job.error?.includes("PRIVATE"));
  }
  const { project, inventory, plan } = fixture();
  const base = makeWorker();
  const { job, done } = coordinate(
    project,
    plan,
    inventory,
    undefined,
    "fixture",
    async (...args) =>
      args[0] === "reviewer" ? { accepted: [9], issues: [] } : base(...args),
  );
  await done;
  assert.equal(job.diagnostics?.failure, "review-references");
});

test("cancellation prevents later roles even when an injected worker resolves late", async () => {
  const { project, inventory, plan } = fixture();
  let resolve!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  const run = coordinate(
    project,
    plan,
    inventory,
    undefined,
    "fixture",
    async (_r, _s, _p, s) => {
      signal = s;
      return new Promise((r) => {
        resolve = r;
      });
    },
  );
  run.cancel();
  await run.done;
  resolve({ gaps: [], questions: [] });
  await new Promise((r) => setImmediate(r));
  assert.equal(run.job.state, "cancelled");
  assert.ok(signal?.aborted);
  assert.equal(run.job.diagnostics?.calls.length, 1);
  assert.equal(run.job.proposals, undefined);
});

test("review diagnostics export excludes raw source, plans, proposals and model prose; accepted output stays draft-only", async () => {
  const { project, inventory, plan } = fixture();
  inventory.documents.push({
    id: "private",
    kind: "specification",
    featureIds: [],
    evidence: { source: "private", revision: "1", excerpt: "PRIVATE-SOURCE" },
  });
  // Rebuild plan because source context is now different.
  const current = discover(project, "test", "api", inventory);
  const { job, done } = coordinate(
    project,
    current,
    inventory,
    undefined,
    "fixture",
    makeWorker(),
  );
  await done;
  assert.equal(job.state, "completed");
  const exported = coordinationReport(job),
    serialized = JSON.stringify(exported);
  assert.equal(exported.diagnostics?.calls.length, 3);
  assert.ok(
    exported.diagnostics?.calls.every(
      (c) =>
        c.promptBytes > 0 &&
        c.durationMs >= 0 &&
        /^[a-f0-9]{64}$/.test(c.promptDigest),
    ),
  );
  assert.ok(!serialized.includes("PRIVATE-SOURCE"));
  assert.ok(!serialized.includes("Health shows Ready"));
  assert.ok(!serialized.includes("Independent health contract"));
  const staged = applyCoordination(job, project, current, inventory);
  assert.equal(staged.review, undefined);
  assert.equal(project.tests.length, 0);
  assert.equal(plan.candidates.length, 1);
});

test("mapped recipes also fail intake preflight before review, including later agent edits", () => {
  const { project, plan } = fixture();
  const p = valid();
  if (p.recipe?.kind !== "api") throw new Error();
  p.recipe.requests[0]!.assertions = [
    { path: "body.status", operator: "matches", expected: ".*" },
  ];
  plan.candidates[0]!.recipe = p.recipe;
  assert.ok(
    preflight(project, plan).some((b) => b.kind === "proposal-quality"),
  );
  p.recipe.requests[0]!.assertions = [
    { path: "body.status", operator: "equals", expected: "Ready" },
    { path: "body.status", operator: "equals", expected: "${expectedStatus}" },
  ];
  assert.ok(
    !assessProposal(p).findings.some(
      (f) => f.code === "contradictory-assertions",
    ),
  );
});
