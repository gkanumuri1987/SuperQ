import test from "node:test";
import assert from "node:assert/strict";
import { designPairwise } from "../src/test-design.js";
const model = {
  title: "Commerce",
  evidence: {
    source: "ED/checkout",
    revision: "7",
    excerpt: "Available browsers and payment choices",
  },
  factors: [
    { name: "browser", values: ["chromium", "firefox", "webkit"] },
    { name: "customer", values: ["guest", "member"] },
    { name: "payment", values: ["card", "wallet"] },
  ],
  forbidden: [{ customer: "guest", payment: "wallet" }],
};

test("pairwise design covers every feasible pair and value, respects constraints and is reproducible", () => {
  const r = designPairwise(model);
  // Independent exhaustive oracle over the small business model.
  const valid = [];
  for (const browser of model.factors[0]!.values)
    for (const customer of model.factors[1]!.values)
      for (const payment of model.factors[2]!.values) {
        if (customer === "guest" && payment === "wallet") continue;
        valid.push({ browser, customer, payment });
      }
  for (const row of valid)
    for (const a of model.factors) {
      assert.ok(
        r.rows.some(
          (selected) => selected[a.name] === row[a.name as keyof typeof row],
        ),
      );
      for (const b of model.factors)
        if (a.name !== b.name)
          assert.ok(
            r.rows.some(
              (selected) =>
                selected[a.name] === row[a.name as keyof typeof row] &&
                selected[b.name] === row[b.name as keyof typeof row],
            ),
          );
    }
  assert.equal(r.summary.validCombinations, 9);
  assert.ok(r.rows.length < valid.length);
  assert.ok(
    r.rows.every(
      (row) => !(row.customer === "guest" && row.payment === "wallet"),
    ),
  );
  assert.deepEqual(r, designPairwise(model));
  assert.equal(r.applicationCoverageProven, false);
  assert.equal(r.reviewRequired, true);
  assert.deepEqual(r.evidence, model.evidence);
});
test("invalid and infeasible models fail explicitly; unreachable values remain visible", () => {
  assert.throws(
    () =>
      designPairwise({
        ...model,
        factors: [model.factors[0], model.factors[0]],
      }),
    /unique/,
  );
  assert.throws(() => designPairwise({ ...model, forbidden: [{}] }), /empty/);
  assert.throws(
    () => designPairwise({ ...model, forbidden: [{ missing: "x" }] }),
    /Unknown/,
  );
  assert.throws(
    () =>
      designPairwise({
        ...model,
        forbidden: [{ customer: "guest" }, { customer: "member" }],
      }),
    /every combination/,
  );
  const r = designPairwise({ ...model, forbidden: [{ browser: "webkit" }] });
  assert.deepEqual(r.infeasibleValues, [
    { factor: "browser", value: "webkit" },
  ]);
  assert.throws(
    () =>
      designPairwise({
        ...model,
        forbidden: [],
        factors: Array.from({ length: 8 }, (_, i) => ({
          name: `f${i}`,
          values: ["0", "1", "2", "3"],
        })),
      }),
    /4096/,
  );
  assert.throws(() =>
    designPairwise({ ...model, evidence: { ...model.evidence, revision: "" } }),
  );
});
test("pair keys cannot collide when values contain separators or factor names are special", () => {
  const r = designPairwise({
    ...model,
    factors: [
      { name: "__proto__", values: ["a,b", "a"] },
      { name: "constructor", values: ["b,c", "c"] },
    ],
    forbidden: [],
  });
  assert.equal(r.rows.length, 4);
  assert.equal(r.summary.requiredObligations, 8);
});

test("CLI emits a portable review-required dataset without an AI provider", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import",
    "tsx",
    "src/cli.ts",
    "design",
    "examples/test-design.json",
  ]);
  const output = JSON.parse(stdout);
  assert.equal(output.reviewRequired, true);
  assert.equal(output.applicationCoverageProven, false);
  assert.equal(output.summary.validCombinations, 9);
  assert.equal(output.model.forbidden[0].customer, "Guest");
});
