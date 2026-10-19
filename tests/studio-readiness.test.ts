import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { chromium, expect } from "@playwright/test";
import { fixtureProject, fixtureInventory } from "./intake-fixtures.js";
import { discover, materialize, intakeSources } from "../src/intake.js";
import { validateProject, type Project } from "../src/model.js";
import { projectFingerprint, reviewFingerprint } from "../src/identity.js";
import { RunRequest, prepareRun, runPreflight } from "../src/run-preflight.js";
import { studioEvidence } from "../src/studio-evidence.js";
import { workQueue } from "../src/work-queue.js";
import { coverage } from "../src/coverage.js";
import { createReport } from "../src/reporting.js";
import {
  startWorkspace,
  type WorkspaceState,
} from "../src/workspace-server.js";

function project(url = "http://127.0.0.1:1/") {
  const p = fixtureProject(url),
    plan = discover(p, "test", "api", fixtureInventory());
  plan.candidates[0]!.recipe = {
    kind: "api",
    requests: [
      {
        path: "/health",
        method: "GET",
        assertions: [
          { path: "status", operator: "equals", expected: 200 },
          { path: "body.status", operator: "equals", expected: "ok" },
        ],
      },
    ],
  };
  const result = materialize(p, plan);
  for (const t of result.tests) {
    t.status = "approved";
    t.review = {
      reviewer: "QE",
      at: new Date().toISOString(),
      digest: reviewFingerprint(result, t),
    };
  }
  return result;
}
const request = (p: Project) =>
  RunRequest.parse({
    environment: "test",
    suite: "intake",
    profile: Object.keys(p.browsers)[0],
    workers: 1,
  });
function job(
  p: Project,
  id: string,
  status: "passed" | "failed",
  environment = "test",
  at = "2026-10-19T10:00:00.000Z",
): WorkspaceState["runs"][number] {
  return {
    id,
    state: "completed",
    at,
    sourceFingerprint: projectFingerprint(p),
    sourceContext: intakeSources(),
    report: createReport(p, environment, "intake", [
      {
        profile: "local",
        provider: "local",
        browser: "chromium",
        results: [{ id: p.tests[0]!.id, status, durationMs: 1 }],
      },
    ]),
  };
}

test("preflight matches filtered DAG selection, detects saved-variable order and environment data without performing network calls", async () => {
  const p = project(),
    parent = structuredClone(p.tests[0]!);
  parent.id = "prerequisite";
  parent.tags = ["setup"];
  parent.steps[0]!.save = { session: "body.session" };
  p.tests.push(parent);
  const child = p.tests[0]!;
  child.dependsOn = [parent.id];
  child.tags = ["selected"];
  child.steps[0]!.input.path = "/health?session=${session}";
  p.execution.includeTags = ["selected"];
  const input = request(p),
    prepared = prepareRun(p, input),
    preview = await runPreflight(p, input);
  assert.deepEqual(preview.roots, prepared.selection.roots);
  assert.deepEqual(
    preview.tests.map((t) => t.id),
    prepared.selection.tests.map((t) => t.id),
  );
  assert.equal(preview.tests.find((t) => t.id === parent.id)!.dependency, true);
  assert.ok(
    preview.issues.some((i) => i.testId === child.id && i.kind === "data"),
  ); // dependency response values are not inherited
  child.steps.unshift({
    ...structuredClone(child.steps[0]!),
    input: { path: "/health" },
    save: { session: "body.session" },
  });
  child.steps[1]!.save = {};
  assert.ok(
    !(await runPreflight(p, input)).issues.some((i) => i.kind === "data"),
  );
  p.environments.test!.data = { PRIVATE_DATA: "must-not-leak" };
  child.steps[0]!.input.headers = { authorization: "${user.token}" };
  p.roles = { buyer: { description: "Buyer" } };
  p.environments.test!.users = {
    buyer: { role: "buyer", tokenEnv: "SUPERQ_MISSING_PREFLIGHT_TOKEN" },
  };
  child.user = "buyer";
  const missing = await runPreflight(p, input);
  assert.ok(missing.issues.some((i) => i.kind === "account"));
  assert.ok(!JSON.stringify(missing).includes("must-not-leak"));
  parent.status = "draft";
  const blocked = await runPreflight(p, input);
  assert.equal(
    blocked.tests.find((t) => t.id === parent.id)!.status,
    "skipped",
  );
  assert.ok(
    blocked.issues.some(
      (i) => i.testId === child.id && i.kind === "dependency",
    ) || blocked.tests.find((t) => t.id === child.id)!.status === "blocked",
  );
  assert.throws(
    () => prepareRun(p, { ...input, testIds: ["missing"] }),
    /Unknown test/,
  );
});

test("criteria-free requirements cannot show proven or complete automation coverage even with reviewed passing tests", () => {
  const p = project();
  p.requirements[0]!.criteria = [];
  p.tests[0]!.covers = {};
  p.tests[0]!.review = {
    reviewer: "QE",
    at: new Date().toISOString(),
    digest: reviewFingerprint(p, p.tests[0]!),
  };
  const result = coverage(p, [
    { id: p.tests[0]!.id, status: "passed", durationMs: 1 },
  ]);
  assert.equal(result.riskWeightedAutomation, 0);
  assert.equal(result.riskWeightedProven, 0);
  assert.ok(result.rows[0]!.gaps.includes("missing-acceptance-criteria"));
});

test("coverage evidence separates environments/accounts and refuses stale sources, old green fallback, draft and incomplete jobs", () => {
  const p = project();
  p.environments.qa = structuredClone(p.environments.test!);
  const passing = job(p, "green", "passed"),
    failing = job(p, "red", "failed", "test", "2026-10-19T11:00:00.000Z"),
    qa = job(p, "qa", "passed", "qa", "2026-10-19T12:00:00.000Z");
  let view = studioEvidence(p, [qa, failing, passing], intakeSources());
  assert.equal(view.contexts.length, 2);
  assert.equal(
    view.contexts.find((c) => c.environment === "test")!.coverage
      .riskWeightedProven,
    0,
  );
  assert.equal(
    view.contexts.find((c) => c.environment === "qa")!.coverage
      .riskWeightedProven,
    1,
  );
  assert.ok(
    studioEvidence(p, [qa, passing], "changed-source").contexts.every(
      (c) => !c.current && c.coverage.riskWeightedProven === 0,
    ),
  );
  const running: WorkspaceState["runs"][number] = {
    ...passing,
    id: "running",
    state: "running",
    at: "2026-10-19T13:00:00.000Z",
    report: undefined,
    configuration: request(p),
  };
  view = studioEvidence(p, [running, passing], intakeSources());
  assert.equal(view.contexts[0]!.runId, "running");
  assert.equal(view.contexts[0]!.coverage.riskWeightedProven, 0);
  assert.equal(
    studioEvidence(p, [{ ...passing, draftValidation: true }], intakeSources())
      .contexts.length,
    0,
  );
  const userProject = structuredClone(p);
  userProject.execution.user = "buyer";
  const userJob = job(userProject, "buyer", "passed");
  userJob.sourceFingerprint = projectFingerprint(p);
  userJob.configuration = { ...request(p), user: "buyer" };
  view = studioEvidence(p, [userJob, passing], intakeSources());
  assert.equal(view.contexts.length, 2);
  assert.equal(view.contexts.find((c) => c.user === "buyer")!.current, true);
});

test("queue prioritizes failed draft trials over approval and does not treat exploratory passes as proof", () => {
  const p = project();
  p.tests[0]!.status = "draft";
  delete p.tests[0]!.review;
  const failed = job(p, "trial", "failed");
  failed.draftValidation = true;
  const state = {
    project: p,
    sample: false,
    connections: {
      repository: "",
      tracker: "",
      documentation: "",
      localRepository: "",
      paths: [],
      watch: false,
    },
    runs: [failed],
    plan: null,
    revision: 1,
    activities: [],
    history: [],
  } satisfies WorkspaceState;
  const queue = workQueue(
    state,
    studioEvidence(p, state.runs, intakeSources()),
    intakeSources(),
  );
  assert.ok(
    queue.items.some(
      (i) => i.id.startsWith("trial:") && i.action === "Inspect run results",
    ),
  );
  assert.ok(!queue.items.some((i) => i.id.startsWith("review:")));
  state.runs[0] = job(p, "trial-green", "passed");
  state.runs[0]!.draftValidation = true;
  const next = workQueue(
    state,
    studioEvidence(p, state.runs, intakeSources()),
    intakeSources(),
  );
  assert.ok(next.items.some((i) => i.stage === "review"));
  assert.equal(
    studioEvidence(p, state.runs, intakeSources()).contexts.length,
    0,
  );
});

test("Studio shows prioritized work, previews exact runs without starting execution and labels evidence by environment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-readiness-"));
  let hits = 0;
  const target = createServer((_req, res) => {
    hits++;
    res.setHeader("content-type", "application/json");
    res.end('{"status":"ok"}');
  });
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  const app = await startWorkspace({ port: 0, file: join(dir, "state.json") }),
    browser = await chromium.launch(),
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const get = async () =>
    await (await fetch(`${app.url}/api/workspace`)).json();
  const post = async (
    path: string,
    body: Record<string, unknown>,
    status = 200,
  ) => {
    const s = await get(),
      response = await fetch(`${app.url}/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superq-token": s.token,
        },
        body: JSON.stringify({ ...body, revision: s.revision }),
      });
    const output = await response.json();
    assert.equal(response.status, status, JSON.stringify(output));
    return output;
  };
  try {
    const p = project(
      `http://127.0.0.1:${(target.address() as { port: number }).port}`,
    );
    p.environments.qa = structuredClone(p.environments.test!);
    await post("import", { project: validateProject(p) });
    await page.goto(app.url);
    await expect(
      page.getByRole("heading", { name: "Make the next step clear." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose run context", exact: true }),
    ).toBeVisible();
    if (process.env.SUPERQ_CAPTURE_STUDIO) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: "/tmp/superq-workqueue-desktop.png",
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "Choose run context", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Run readiness", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/1 selected roots.*1 configured to run/),
    ).toBeVisible();
    if (process.env.SUPERQ_CAPTURE_STUDIO) {
      await page
        .getByRole("heading", { name: "Run readiness", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: "/tmp/superq-run-readiness.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("heading", { name: "Run readiness", exact: true })
        .scrollIntoViewIfNeeded();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({ path: "/tmp/superq-run-readiness-mobile.png" });
      await page.setViewportSize({ width: 1440, height: 1100 });
    }
    assert.equal(hits, 0);
    assert.equal((await get()).runs.length, 0);
    await page.getByLabel("Suite", { exact: true }).selectOption("intake");
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect
      .poll(async () => (await get()).runs[0]?.state)
      .toBe("completed");
    assert.equal(hits, 1);
    await page.goto(`${app.url}/#coverage`);
    await expect(
      page.getByLabel("Coverage evidence", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Current execution · completed/)).toBeVisible();
    let s = await get();
    assert.equal(s.evidence.contexts[0].environment, "test");
    assert.equal(s.coverage.riskWeightedProven, 1);
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export JSON", exact: true })
      .click();
    const download = await downloadEvent;
    const exported = JSON.parse(
      await readFile((await download.path())!, "utf8"),
    );
    assert.equal(exported.evidenceContext.environment, "test");
    assert.equal(exported.evidenceContext.current, true);
    const preview = await post("runs/preflight", {
      ...request(p),
      environment: "qa",
    });
    assert.equal(preview.tests[0].status, "runnable");
    assert.equal(hits, 1);
    assert.equal((await get()).runs.length, 1);
    await post("runs", { ...request(p), environment: "qa" }, 202);
    await expect
      .poll(async () => (await get()).runs[0].state)
      .toBe("completed");
    await page.reload();
    await expect
      .poll(async () =>
        page
          .getByLabel("Coverage evidence", { exact: true })
          .locator("option")
          .count(),
      )
      .toBe(2);
    s = await get();
    await page
      .getByLabel("Coverage evidence", { exact: true })
      .selectOption(
        s.evidence.contexts.find(
          (c: { environment: string }) => c.environment === "test",
        ).key,
      );
    await expect(
      page.getByLabel("Coverage evidence", { exact: true }),
    ).toHaveValue(
      s.evidence.contexts.find(
        (c: { environment: string }) => c.environment === "test",
      ).key,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    await new Promise<void>((r) => target.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("version comparison traces shared setup and nested locator changes to dependent tests and stages actual definitions", async () => {
  const { extractSetup } = await import("../src/web-setups.js"),
    { compareProjects, stageChanges } = await import("../src/maintenance.js");
  const p = fixtureProject(),
    manual = discover(p, "test", "web", fixtureInventory());
  manual.candidates[0]!.recipe = extractSetup(
    p,
    {
      kind: "web",
      commands: [
        { type: "goto", path: "/" },
        {
          type: "fill",
          locator: { strategy: "label", value: "Customer" },
          value: "Synthetic",
        },
        {
          type: "expectText",
          locator: { strategy: "testId", value: "status" },
          value: "Ready",
        },
      ],
    },
    "prepare",
    "Prepare customer",
    2,
  ) as Extract<import("../src/intake.js").Recipe, { kind: "web" }>;
  const original = materialize(p, manual),
    child = structuredClone(original.tests[0]!);
  child.id = "dependent-case";
  child.dependsOn = [original.tests[0]!.id];
  child.steps[0]!.input.setupIds = [];
  original.tests.push(child);
  const updated = structuredClone(original);
  updated.webSetups!.prepare!.title = "Updated shared setup";
  let comparison = compareProjects(original, updated);
  assert.equal(comparison.items.length, 2);
  assert.ok(
    comparison.items[0]!.changes.some(
      (c) => c.label === "Shared setup prepare",
    ),
  );
  const staged = stageChanges(
    original,
    comparison,
    comparison.items.map((i) => i.id),
  );
  assert.equal(staged.webSetups!.prepare!.title, "Updated shared setup");
  assert.ok(staged.tests.every((t) => t.status === "draft" && !t.review));
  const locator = Object.keys(original.locators).find(
    (id) => original.locators[id]!.value === "Customer",
  )!;
  const locatorUpdate = structuredClone(original);
  locatorUpdate.locators[locator]!.value = "Buyer";
  comparison = compareProjects(original, locatorUpdate);
  assert.equal(comparison.items.length, 2);
  assert.ok(
    comparison.items[0]!.changes.some(
      (c) => c.kind === "UI" && c.label === locator,
    ),
  );
  const concurrent = structuredClone(original);
  concurrent.webSetups!.prepare!.title = "Changed after analysis";
  assert.throws(
    () =>
      stageChanges(
        concurrent,
        comparison,
        comparison.items.map((i) => i.id),
      ),
    /sources changed/,
  );
});

test("cloud and saved SSO preflight reports configuration blockers without provider sessions or credential values", async () => {
  const { BrowserProfile } = await import("../src/config.js"),
    p = project();
  p.browsers.remote = BrowserProfile.parse({
    provider: "browserstack",
    os: "Windows",
    osVersion: "11",
    maxSessions: 1,
  });
  const previous = {
    username: process.env.BROWSERSTACK_USERNAME,
    key: process.env.BROWSERSTACK_ACCESS_KEY,
  };
  process.env.BROWSERSTACK_USERNAME = "private-cloud-user";
  process.env.BROWSERSTACK_ACCESS_KEY = "private-cloud-key";
  const dir = await mkdtemp(join(tmpdir(), "superq-preview-sso-"));
  try {
    let preview = await runPreflight(p, {
      ...request(p),
      profile: "remote",
      workers: 2,
    });
    assert.ok(preview.issues.some((i) => i.kind === "cloud-limit"));
    assert.ok(!preview.canStart);
    assert.ok(!JSON.stringify(preview).includes("private-cloud"));
    delete process.env.BROWSERSTACK_ACCESS_KEY;
    preview = await runPreflight(p, { ...request(p), profile: "remote" });
    assert.ok(preview.issues.some((i) => i.kind === "cloud-credentials"));
    const manual = discover(
      fixtureProject(),
      "test",
      "web",
      fixtureInventory(),
    );
    manual.candidates[0]!.recipe = {
      kind: "web",
      commands: [
        { type: "goto", path: "/" },
        {
          type: "expectText",
          locator: { strategy: "testId", value: "status" },
          value: "Ready",
        },
      ],
    };
    const web = materialize(fixtureProject(), manual);
    web.roles = { buyer: { description: "Buyer" } };
    web.environments.test!.users = {
      buyer: {
        role: "buyer",
        username: "qa",
        passwordEnv: "MUST_NOT_READ_FOR_SSO",
      },
    };
    web.environments.test!.sso = {
      startPath: "/login",
      successPath: "/home",
      successText: "Welcome qa",
      allowedOrigins: [],
      maxAgeMinutes: 10,
    };
    web.tests[0]!.user = "buyer";
    web.tests[0]!.status = "approved";
    preview = await runPreflight(web, request(web), { sessionDirectory: dir });
    assert.ok(preview.issues.some((i) => i.kind === "sso"));
    assert.ok(!preview.issues.some((i) => i.kind === "account"));
  } finally {
    if (previous.username === undefined)
      delete process.env.BROWSERSTACK_USERNAME;
    else process.env.BROWSERSTACK_USERNAME = previous.username;
    if (previous.key === undefined) delete process.env.BROWSERSTACK_ACCESS_KEY;
    else process.env.BROWSERSTACK_ACCESS_KEY = previous.key;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Try this test retains its exact job when a later run of the same case fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-own-trial-"));
  let healthy = true;
  const target = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: healthy ? "ok" : "bad" }));
  });
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  const app = await startWorkspace({ port: 0, file: join(dir, "state.json") }),
    browser = await chromium.launch(),
    page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const get = async () =>
    await (await fetch(`${app.url}/api/workspace`)).json();
  const post = async (
    path: string,
    body: Record<string, unknown>,
    status = 200,
  ) => {
    const s = await get(),
      r = await fetch(`${app.url}/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superq-token": s.token,
        },
        body: JSON.stringify({ ...body, revision: s.revision }),
      });
    const json = await r.json();
    assert.equal(r.status, status, JSON.stringify(json));
    return json;
  };
  try {
    const p = project(
      `http://127.0.0.1:${(target.address() as { port: number }).port}`,
    );
    await post("import", { project: p });
    await page.goto(app.url);
    await page
      .getByRole("button", { name: "Through an API", exact: true })
      .click();
    await page
      .getByLabel("Functional expectation")
      .selectOption(
        JSON.stringify([
          p.requirements[0]!.id,
          p.requirements[0]!.criteria[0]!.id,
        ]),
      );
    await page.getByLabel("API path", { exact: true }).fill("/health");
    await page.getByLabel("Response field", { exact: true }).fill("status");
    await page.getByLabel("Expected value", { exact: true }).fill("ok");
    await page
      .getByRole("button", { name: "Create functional test", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Try this test", exact: true })
      .click();
    await page.getByText("The check passed", { exact: true }).waitFor();
    let state = await get();
    const own = state.runs[0],
      id = own.configuration.testIds[0];
    healthy = false;
    await post("runs", own.configuration, 202);
    await expect
      .poll(async () => (await get()).runs[0].state)
      .toBe("completed");
    state = await get();
    assert.equal(
      state.runs[0].report.results.find((r: { id: string }) => r.id === id)
        .status,
      "failed",
    );
    await expect(
      page.getByText(`Run ${own.id.slice(0, 8)}`, { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("The check passed", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The check failed", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await browser.close();
    await app.close();
    await new Promise<void>((r) => target.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
