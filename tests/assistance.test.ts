import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium, expect, type Browser } from "@playwright/test";
import { mkdtemp, rm, stat, readdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRecording } from "../src/recorder.js";
import { TraceStore } from "../src/trace-artifacts.js";
import {
  coordinate,
  applyCoordination,
  type Worker,
} from "../src/coordinator.js";
import { discover, materialize } from "../src/intake.js";
import { fixtureProject, fixtureInventory } from "./intake-fixtures.js";
import { createAdapters } from "../src/adapters.js";
import { run } from "../src/runner.js";
import { startWorkspace } from "../src/workspace-server.js";

const html = `<label>Customer<input data-testid="customer"></label><label>Password<input type="password"></label><label>Choice<select><option>A</option><option>B</option></select></label><label>Accept<input type="checkbox"></label><button onclick="document.querySelector('p').textContent='Confirmed'">Submit</button><p data-testid="status">Ready</p>`;
async function fixture() {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
const proposal = {
  title: "Confirm submission result",
  steps: [{ action: "Submit the form", expected: "Health shows Ready" }],
  evidence: [{ source: "ED", revision: "1", excerpt: "Health shows Ready" }],
};
const worker: Worker = async (role) =>
  role === "analyst"
    ? {
        gaps: [{ description: "Confirmation needs coverage", sources: ["ED"] }],
        questions: [],
      }
    : role === "designer"
      ? { proposals: [proposal] }
      : { accepted: [0], issues: [] };

test("recorder captures real trusted interactions without entered values; explicit oracle, placeholder and catalog replay", async () => {
  const app = await fixture();
  let browser: Browser | undefined;
  const recording = await startRecording(
    app.url,
    "/",
    async (proxy) => (browser = await chromium.launch({ proxy })),
  );
  try {
    await assert.rejects(
      startRecording(app.url, "/?token=private"),
      /without query/,
    );
    const page = browser!.contexts()[0]!.pages()[0]!;
    await page.getByLabel("Customer").fill("PRIVATE-CUSTOMER");
    await page.getByLabel("Password").fill("PRIVATE-PASSWORD");
    await page.getByLabel("Accept").check();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect.poll(() => recording.snapshot().commands.length).toBe(4);
    assert.throws(() => recording.finish(), /explicit native assertion/);
    recording.assert({
      type: "expectText",
      locator: { strategy: "testId", value: "status" },
      value: "Confirmed",
    });
    const recipe = recording.finish();
    const text = JSON.stringify(recording.snapshot());
    assert.ok(!text.includes("PRIVATE"));
    assert.ok(text.includes("sensitive or unsupported"));
    assert.ok(text.includes("${recorded.field1}"));
    const p = fixtureProject(app.url),
      plan = discover(p, "test", "web", fixtureInventory());
    plan.candidates[0]!.recipe = recipe;
    const project = materialize(p, plan);
    project.tests[0]!.status = "approved";
    project.tests[0]!.data = { "recorded.field1": "Synthetic" };
    const adapters = createAdapters();
    try {
      assert.equal(
        (await run(project, "test", "intake", adapters.registry))[0]!.status,
        "passed",
      );
    } finally {
      await adapters.close();
    }
    const other = await browser!.contexts()[0]!.newPage();
    await assert.rejects(other.goto("http://127.0.0.1:1/"));
    await other.close();
  } finally {
    await recording.close();
    await app.close();
  }
});

test("three scoped local workers validate evidence, remain draft-only and reject stale staging, unsupported citations and cancellation", async () => {
  const p = fixtureProject(),
    inventory = fixtureInventory(),
    plan = discover(p, "test", "web", inventory),
    calls: string[] = [];
  const job = coordinate(
    p,
    plan,
    inventory,
    undefined,
    "mock-installed-model",
    async (...args) => {
      calls.push(args[0]);
      return worker(...args);
    },
  );
  assert.equal((await job.done).state, "completed");
  assert.deepEqual(calls, ["analyst", "designer", "reviewer"]);
  assert.equal(plan.candidates.length, 1);
  const changed = structuredClone(plan);
  changed.candidates[0]!.selected = false;
  assert.throws(
    () => applyCoordination(job.job, p, changed, inventory),
    /stale/,
  );
  const staged = applyCoordination(job.job, p, plan, inventory);
  assert.equal(staged.candidates.length, 2);
  assert.equal(staged.review, undefined);
  assert.equal(p.tests.length, 0);
  const bad = coordinate(
    p,
    plan,
    inventory,
    undefined,
    "mock",
    async (role, ...args) =>
      role === "designer"
        ? {
            proposals: [
              {
                ...proposal,
                evidence: [
                  {
                    source: "ED",
                    revision: "1",
                    excerpt: "Fabricated behavior",
                  },
                ],
              },
            ],
          }
        : worker(role, ...args),
  );
  assert.equal((await bad.done).state, "failed");
  assert.equal(bad.job.proposals, undefined);
  const cancelled = coordinate(
    p,
    plan,
    inventory,
    undefined,
    "mock",
    async () => new Promise(() => {}),
  );
  cancelled.cancel();
  assert.equal((await cancelled.done).state, "cancelled");
});

test("native traces record failed journeys, use private files and expire; no trace without opt-in", async () => {
  const app = await fixture(),
    dir = await mkdtemp(join(tmpdir(), "superq-trace-"));
  const p = fixtureProject(app.url),
    plan = discover(p, "test", "web", fixtureInventory());
  plan.candidates[0]!.recipe = {
    kind: "web",
    commands: [
      { type: "goto", path: "/" },
      {
        type: "expectText",
        locator: { strategy: "testId", value: "status" },
        value: "Wrong",
        timeoutMs: 100,
      },
    ],
  };
  const project = materialize(p, plan);
  project.tests[0]!.status = "approved";
  const withoutTrace = createAdapters();
  try {
    assert.equal(
      (await run(project, "test", "intake", withoutTrace.registry))[0]!.status,
      "failed",
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await withoutTrace.close();
  }
  const store = new TraceStore(dir),
    adapters = createAdapters(undefined, undefined, undefined, store);
  try {
    assert.equal(
      (await run(project, "test", "intake", adapters.registry))[0]!.status,
      "failed",
    );
    assert.equal(store.artifacts.length, 1);
    const artifact = store.artifacts[0]!,
      bytes = await store.read(artifact);
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    assert.equal((await stat(join(dir, `${artifact.id}.zip`))).mode & 0o077, 0);
    artifact.expiresAt = new Date(0).toISOString();
    await assert.rejects(store.read(artifact), /expired/);
    const path = join(dir, `${artifact.id}.zip`);
    await utimes(path, new Date(0), new Date(0));
    await store.prune();
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await adapters.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("workspace integrates recorder, bounded local agents and authenticated trace downloads; UI stays reviewable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-assistance-")),
    target = await fixture();
  let captureBrowser: Browser | undefined;
  const app = await startWorkspace({
    port: 0,
    file: join(dir, "state.json"),
    agentWorker: worker,
    recorderConnector: async (proxy) =>
      (captureBrowser = await chromium.launch({ proxy })),
  });
  const browser = await chromium.launch(),
    page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const get = async () =>
    await (await fetch(`${app.url}/api/workspace`)).json();
  const post = async (
    path: string,
    body: Record<string, unknown>,
    expected = 200,
  ) => {
    const s = await get();
    const r = await fetch(`${app.url}/api/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-superq-token": s.token,
      },
      body: JSON.stringify({ ...body, revision: s.revision }),
    });
    const json = await r.json();
    assert.equal(r.status, expected, JSON.stringify(json));
    return json;
  };
  try {
    await post("import", { project: fixtureProject(target.url) });
    await post("planning", { planning: fixtureInventory() });
    await post("intake/analyze", { environment: "test", preference: "web" });
    await page.goto(`${app.url}/#intake`);
    await page
      .getByText("Optional: record a flow or ask AI for more tests", {
        exact: true,
      })
      .click();
    await page
      .getByText("Need help with these tests?", { exact: true })
      .waitFor();
    await page.getByText("Record a web flow", { exact: true }).click();
    await page.getByRole("button", { name: "Open recording browser" }).click();
    await expect
      .poll(() => captureBrowser?.contexts()[0]?.pages().length ?? 0)
      .toBe(1);
    const capture = captureBrowser!.contexts()[0]!.pages()[0]!;
    await capture.waitForLoadState();
    await capture.getByRole("button", { name: "Submit" }).click();
    await page
      .getByLabel("Expected result locator", { exact: true })
      .fill("status");
    await page.getByLabel("Expected text", { exact: true }).fill("Confirmed");
    await page
      .getByRole("button", { name: "Add expected result", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save recording as draft" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Save recording as draft" }).click();
    await expect
      .poll(async () => {
        const s = await get();
        return !!s.intake.candidates[0].recipe && !s.recording;
      })
      .toBe(true);
    await post("coordination/start", { model: "mock-installed-model" });
    await expect
      .poll(async () => (await get()).coordination.state)
      .toBe("completed");
    await page
      .getByText("Three-agent coverage review · local Ollama", { exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "AI proposal quality" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "0 blocking findings · 1 review notes · 3 of 3 model calls used",
      ),
    ).toBeVisible();
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export AI review diagnostics" })
      .click();
    const exportedFile = await (await downloadEvent).path();
    const exported = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(exportedFile!, "utf8"),
      ),
    );
    assert.equal(exported.diagnostics.calls.length, 3);
    assert.equal(exported.humanApproval, "required");
    assert.ok(!JSON.stringify(exported).includes("Health shows Ready"));
    if (process.env.SUPERQ_CAPTURE_STUDIO) {
      await page
        .getByRole("region", { name: "AI proposal quality" })
        .screenshot({ path: "/tmp/superq-ai-quality-desktop.png" });
      await expect(
        page.getByText("Coordination: completed", { exact: true }),
      ).toBeVisible();
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: "/tmp/superq-assistance-studio.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(async () => (await page.locator(".sidebar").boundingBox())!.x)
        .toBeLessThan(-200);
      await page
        .getByRole("region", { name: "AI proposal quality" })
        .screenshot({ path: "/tmp/superq-ai-quality-mobile.png" });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: "/tmp/superq-assistance-mobile.png",
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.setViewportSize({ width: 1400, height: 1000 });
    }
    await post("coordination/apply", {});
    let state = await get();
    assert.equal(state.intake.review, undefined);
    assert.equal(state.intake.candidates.length, 2);
    await post("intake/map", {
      candidateId: state.intake.candidates[1].id,
      patch: { selected: false },
    });
    await post("intake/review", { reviewer: "QE" });
    await post("intake/generate", {});
    state = await get();
    assert.deepEqual(await readdir(join(dir, "private-traces")), []);
    const runBody = {
      environment: "test",
      suite: "intake",
      profile: Object.keys(state.project.browsers)[0],
      workers: 1,
      validateDrafts: true,
      captureTrace: true,
    };
    await post("runs", runBody, 400);
    await post("runs", { ...runBody, acknowledgeSensitiveTrace: true }, 202);
    await expect
      .poll(async () => (await get()).runs[0].state)
      .toBe("completed");
    state = await get();
    const trace = state.runs[0].traces[0];
    assert.ok(trace);
    assert.equal(state.runs[0].report.summary.passed, 1);
    assert.equal(
      (await fetch(`${app.url}/api/traces/${trace.id}`)).status,
      403,
    );
    const download = await fetch(`${app.url}/api/traces/${trace.id}`, {
      headers: { "x-superq-token": state.token },
    });
    assert.equal(download.status, 200);
    assert.equal(
      Buffer.from(await download.arrayBuffer())
        .subarray(0, 2)
        .toString(),
      "PK",
    );
    const report = await (
      await fetch(`${app.url}/api/reports/${state.runs[0].id}/json`)
    ).text();
    assert.ok(!report.includes(trace.id));
    assert.ok(!report.includes("private-traces"));
    await page.goto(`${app.url}/#runs`);
    await expect(
      page.getByRole("button", { name: /Download trace/ }),
    ).toBeVisible();
    await post("traces/delete", { id: trace.id });
    await assert.rejects(
      import("node:fs/promises").then((fs) =>
        fs.readFile(join(dir, "private-traces", `${trace.id}.zip`)),
      ),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${app.url}/#intake`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    await target.close();
    await rm(dir, { recursive: true, force: true });
  }
});
