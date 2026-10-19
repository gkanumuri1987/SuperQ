import test from "node:test";
import assert from "node:assert/strict";
import { createQuickTest } from "../src/quick-test.js";
import { sampleProject } from "../src/workspace/sample.js";
const api = {
  id: "SQ-example",
  title: "Inventory available",
  requirementId: "REQ-104",
  criterionId: "AC-5",
  path: "api/inventory",
  kind: "api",
  responseField: "available",
  expected: true,
};
test("quick functional checks create executable drafts, preserve evidence and reuse shared actions", () => {
  const original = sampleProject(4310),
    before = JSON.stringify(original),
    p = createQuickTest(original, api),
    t = p.tests.at(-1)!;
  assert.equal(JSON.stringify(original), before);
  assert.equal(p.catalog.length, original.catalog.length);
  assert.equal(t.status, "draft");
  assert.equal(t.review, undefined);
  assert.equal(t.steps[0]!.action, "http.request");
  assert.deepEqual(t.covers, { "REQ-104": ["AC-5"] });
  assert.deepEqual(t.evidenceIds, ["SPEC-ACCOUNT"]);
  assert.deepEqual(t.steps[0]!.assertions, [
    { path: "status", operator: "equals", expected: 200 },
    { path: "body.available", operator: "equals", expected: true },
  ]);
  const second = createQuickTest(p, {
    ...api,
    id: "SQ-false",
    expected: false,
  });
  assert.equal(second.tests.at(-1)!.steps[0]!.assertions[1]!.expected, false);
  assert.throws(() => createQuickTest(p, api), /already been saved/);
  assert.throws(
    () =>
      createQuickTest(p, { ...api, id: "SQ-other", criterionId: "missing" }),
    /current functional expectation/,
  );
  assert.throws(
    () =>
      createQuickTest(p, {
        ...api,
        id: "SQ-other",
        path: "//external.invalid/check",
      }),
    /configured application/,
  );
  assert.throws(
    () => createQuickTest(p, { ...api, id: "SQ-other", responseField: "" }),
    /response field/,
  );
});
test("screen checks reuse controls and compile explicit interactions with an unchanged oracle", () => {
  const web = {
    ...api,
    kind: "web",
    path: "checkout",
    fields: [{ label: "Email", value: "customer@example.invalid" }],
    button: "Place order",
    expectation: { kind: "status", text: "Order confirmed" },
  };
  const first = createQuickTest(sampleProject(4310), web);
  const second = createQuickTest(first, { ...web, id: "SQ-reuse" });
  assert.deepEqual(second.locators, first.locators);
  assert.equal(second.catalog.length, 2);
  const step = second.tests.at(-1)!.steps[0]!;
  const commands = step.input.commands as { type: string; value?: string }[];
  assert.deepEqual(
    commands.map((c) => c.type),
    ["goto", "fill", "click", "expectText"],
  );
  assert.equal(commands[3]!.value, "Order confirmed");
  assert.equal(step.assertions[0]!.expected, "Order confirmed");
  assert.throws(
    () =>
      createQuickTest(first, {
        ...web,
        id: "SQ-missing",
        expectation: { kind: "testId", text: "Confirmed" },
      }),
    /test ID/,
  );
});

test("simple screen text checks detect wrong results and reject hidden matching text", async () => {
  const { createServer } = await import("node:http");
  const { createAdapters } = await import("../src/adapters.js");
  const { run } = await import("../src/runner.js");
  let content = "<p>Order confirmed</p>";
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(content);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const p = createQuickTest(sampleProject(4310), {
    id: "SQ-screen",
    title: "Confirmation",
    requirementId: "REQ-101",
    criterionId: "AC-2",
    path: "/",
    kind: "web",
    expectation: { kind: "text", text: "Order confirmed" },
  });
  p.environments.sample!.baseURL = `http://127.0.0.1:${addr.port}`;
  p.execution.testIds = ["SQ-screen"];
  p.tests.at(-1)!.status = "approved";
  const commands = p.tests.at(-1)!.steps[0]!.input.commands as Record<
    string,
    unknown
  >[];
  commands.at(-1)!.timeoutMs = 300;
  const adapters = createAdapters();
  try {
    assert.equal(
      (await run(p, "sample", "regression", adapters.registry))[0]!.status,
      "passed",
    );
    content = "<p>Order rejected</p>";
    assert.equal(
      (await run(p, "sample", "regression", adapters.registry))[0]!.status,
      "failed",
    );
    content = '<p style="display:none">Order confirmed</p>';
    assert.equal(
      (await run(p, "sample", "regression", adapters.registry))[0]!.status,
      "failed",
    );
  } finally {
    await adapters.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
