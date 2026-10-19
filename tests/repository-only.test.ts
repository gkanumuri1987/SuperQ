import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startWorkspace } from "../src/workspace-server.js";
import { coordinate, type Worker } from "../src/coordinator.js";
import { discover } from "../src/intake.js";
import { fixtureProject, fixtureSnapshot } from "./intake-fixtures.js";
import { BrowserProfile } from "../src/config.js";
import { Registry } from "../src/runner.js";
const code = 'export function health() { return { status: "ready" }; }';
test("source-only functionality citations reject invented revisions before designing tests", async () => {
  const p = fixtureProject(),
    snapshot = fixtureSnapshot();
  snapshot.files[0]!.path = "health.ts";
  snapshot.files[0]!.content = code;
  const plan = discover(p, "test", "api", undefined, snapshot);
  let calls = 0;
  const job = coordinate(p, plan, undefined, snapshot, "fixture", async () => {
    calls++;
    return {
      functionality: [
        {
          name: "Health",
          source: "health.ts",
          revision: "invented",
          excerpt: code,
        },
      ],
      gaps: [],
      questions: [],
    };
  });
  await job.done;
  assert.equal(calls, 1);
  assert.equal(job.job.state, "failed");
  assert.equal(job.job.diagnostics?.failure, "citations");
  assert.equal(job.job.analysis, undefined);
  assert.equal(plan.candidates.length, 0);
});
test("repository-only Studio generates cited proposals without stories/docs/tests, gates automation on review and selects local/cloud trials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-source-only-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  await writeFile(join(dir, "health.ts"), code);
  git("add", "health.ts");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-qm",
    "Fixture",
  );
  const revision = git("rev-parse", "HEAD");
  const seen: string[] = [];
  const worker: Worker = async (role, _schema, prompt) => {
    const context = JSON.parse(prompt).context;
    assert.equal(context.automationPreference, "api");
    assert.equal(context.intakeMode, "repository");
    assert.equal(context.requirements.length, 0);
    assert.equal(context.snapshot.files[0].content, code);
    if (role === "analyst")
      return {
        functionality: [
          {
            name: "Health status response",
            source: "health.ts",
            revision,
            excerpt: code,
          },
        ],
        gaps: [
          {
            description: "No health response coverage",
            sources: ["health.ts"],
          },
        ],
        questions: ["Confirm health status is intended to be ready."],
      };
    if (role === "designer")
      return {
        proposals: [
          {
            title: "Health returns ready",
            steps: [
              {
                action: "Request GET /health",
                expected: "Response status is ready",
              },
            ],
            evidence: [{ source: "health.ts", revision, excerpt: code }],
            recipe: {
              kind: "api",
              requests: [
                {
                  method: "GET",
                  path: "/health",
                  assertions: [
                    {
                      path: "body.status",
                      operator: "equals",
                      expected: "ready",
                    },
                  ],
                },
              ],
            },
          },
        ],
      };
    return { accepted: [0], issues: [] };
  };
  const app = await startWorkspace({
    port: 0,
    file: join(dir, "state.json"),
    agentWorker: worker,
    adapterFactory: (profile) => {
      seen.push(BrowserProfile.parse(profile).provider);
      return {
        registry: new Registry().register("api:request", async () => ({
          status: 200,
          body: { status: "ready" },
        })),
        close: async () => {},
      };
    },
  });
  const browser = await chromium.launch(),
    page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const get = async () =>
    await (await fetch(app.url + "/api/workspace")).json();
  const post = async (
    path: string,
    data: Record<string, unknown>,
    expected = 200,
  ) => {
    const s = await get();
    const r = await fetch(app.url + "/api/" + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-superq-token": s.token,
      },
      body: JSON.stringify({ ...data, revision: s.revision }),
    });
    const result = await r.json();
    assert.equal(r.status, expected, JSON.stringify(result));
    return result;
  };
  try {
    const p = fixtureProject();
    p.browsers.remote = BrowserProfile.parse({
      provider: "browserstack",
      os: "Windows",
      osVersion: "11",
    });
    await post("import", { project: p });
    await post(
      "intake/connect",
      {
        environment: "test",
        baseURL: "https://changed.example.test",
        localRepository: dir,
        paths: ["missing.ts"],
      },
      400,
    );
    assert.equal((await get()).sourceSnapshot, undefined);
    assert.equal(
      (await get()).project.environments.test.baseURL,
      p.environments.test!.baseURL,
    );
    await page.goto(app.url + "/#intake");
    await expect(
      page
        .getByRole("navigation", { name: "Workflow stages" })
        .getByRole("button", { name: "2 Review tests", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("region", { name: "Automation capabilities" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Enable proposal-only MCP connection" }),
    ).not.toBeVisible();
    if (process.env.SUPERQ_CAPTURE_STUDIO) {
      await page.screenshot({
        path: "/tmp/superq-first-run-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "/tmp/superq-first-run-mobile.png",
        fullPage: true,
        animations: "disabled",
      });
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await page
      .getByRole("button", { name: "Connect repository", exact: true })
      .click();
    await page.getByLabel("Repository folder", { exact: true }).fill(dir);
    await page
      .getByLabel("Files to analyze", { exact: false })
      .fill("health.ts");
    const connecting = page.waitForRequest((r) =>
      r.url().endsWith("/api/intake/connect"),
    );
    await page
      .getByRole("button", { name: "Connect & scan", exact: true })
      .click();
    assert.deepEqual((await connecting).postDataJSON().paths, ["health.ts"]);
    await expect
      .poll(async () => (await get()).sourceSnapshot?.files.length)
      .toBe(1);
    await expect(
      page.getByLabel("Repository folder", { exact: true }),
    ).not.toBeVisible();
    await page.getByLabel("Automation preference").selectOption("api");
    await page.getByRole("button", { name: "Continue to test cases" }).click();
    await expect(
      page.getByText("Generate test cases from repository", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Connect your application" }),
    ).not.toBeVisible();
    assert.equal((await get()).intake.candidates.length, 0);
    await page.getByLabel("Installed local Ollama model").fill("fixture-local");
    await page
      .getByRole("button", { name: "Analyze functionality & propose tests" })
      .click();
    await expect
      .poll(async () => (await get()).coordination.state)
      .toBe("completed");
    await expect(
      page.getByRole("region", { name: "Observed application functionality" }),
    ).toContainText("Health status response");
    if (process.env.SUPERQ_CAPTURE_STUDIO)
      await page.screenshot({
        path: "/tmp/superq-source-analysis-desktop.png",
        fullPage: true,
      });
    assert.equal((await get()).project.tests.length, 0);
    await page
      .getByRole("button", { name: "Stage accepted proposals for QE review" })
      .click();
    await expect
      .poll(async () => (await get()).intake.candidates.length)
      .toBe(1);
    await post("intake/generate", {}, 400);
    assert.equal((await get()).project.tests.length, 0);
    await page.getByLabel("QE reviewer", { exact: true }).fill("QE");
    await page
      .getByLabel(
        "I reviewed scope, expected results, prerequisites and test-environment side effects.",
      )
      .check();
    await page
      .getByRole("button", { name: "Approve plan for automation" })
      .click();
    await expect(
      page.getByRole("button", { name: "Generate reviewed automation" }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Generate reviewed automation" })
      .click();
    await expect(page.getByLabel("Trial browser profile")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Review test cases" }),
    ).not.toBeVisible();
    await page
      .getByRole("button", { name: "2 Review tests", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Review test cases" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "3 Run", exact: true }).click();
    assert.equal((await get()).project.tests[0].status, "draft");
    await post("intake/trial", { profile: "remote" }, 400);
    assert.deepEqual(seen, []);
    await page.getByLabel("Trial browser profile").selectOption("remote");
    await expect(
      page.getByRole("button", { name: "Run cloud draft trial" }),
    ).toBeDisabled();
    await page
      .getByLabel(
        "I confirm this trial uses my cloud account and may incur session charges.",
      )
      .check();
    const sent = page.waitForRequest((r) =>
      r.url().endsWith("/api/intake/trial"),
    );
    await page.getByRole("button", { name: "Run cloud draft trial" }).click();
    assert.equal((await sent).postDataJSON().profile, "remote");
    await expect
      .poll(async () => (await get()).runs[0]?.state)
      .toBe("completed");
    assert.deepEqual(seen, ["browserstack"]);
    assert.equal((await get()).runs[0].draftValidation, true);
    await post("intake/trial", {}, 202);
    await expect
      .poll(async () => (await get()).runs[0]?.state)
      .toBe("completed");
    assert.deepEqual(seen, ["browserstack", "local"]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(
      page.getByText("Trial: completed", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Trial browser profile")).toBeVisible();
    await page.getByRole("button", { name: "1 Connect", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Connect your application" }),
    ).toBeVisible();
    await expect(page.getByLabel("Trial browser profile")).not.toBeVisible();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    if (process.env.SUPERQ_CAPTURE_STUDIO)
      await page.screenshot({
        path: "/tmp/superq-source-only-mobile.png",
        fullPage: true,
      });
    assert.equal(git("rev-parse", "HEAD"), revision);
    assert.equal(git("diff", "--", "health.ts"), "");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
