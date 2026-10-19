import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { chromium, expect } from "@playwright/test";
import { startWorkspace } from "../src/workspace-server.js";
import { fixtureInventory, fixtureProject } from "./intake-fixtures.js";
import { discover, materialize } from "../src/intake.js";
import { ensureLocator } from "../src/catalog.js";
import { reviewFingerprint } from "../src/identity.js";

test("Studio exposes capabilities, configures healing, reviews an actual repair and runs local framework checks at desktop/mobile widths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-care-studio-"));
  const application = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      '<button data-testid="new-submit" onclick="document.querySelector(\'p\').textContent=\'Confirmed\'">Submit</button><p role="status">Ready</p>',
    );
  });
  await new Promise<void>((r) => application.listen(0, "127.0.0.1", r));
  const app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
  const browser = await chromium.launch(),
    page = await browser.newPage({ viewport: { width: 1480, height: 1050 } }),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    let state = await (await fetch(`${app.url}/api/workspace`)).json();
    const p = fixtureProject(
        `http://127.0.0.1:${(application.address() as { port: number }).port}/`,
      ),
      inventory = fixtureInventory(),
      plan = discover(p, "test", "web", inventory);
    plan.candidates[0]!.recipe = {
      kind: "web",
      commands: [
        { type: "goto", path: "/" },
        { type: "click", locator: { strategy: "testId", value: "old-submit" } },
        {
          type: "expectText",
          locator: { strategy: "role", value: "status" },
          value: "Confirmed",
        },
      ],
    };
    const project = materialize(p, plan),
      original = Object.keys(project.locators).find(
        (id) => project.locators[id]!.value === "old-submit",
      )!,
      replacement = ensureLocator(project, {
        strategy: "testId",
        value: "new-submit",
      });
    project.tests[0]!.status = "approved";
    project.tests[0]!.review = {
      reviewer: "QE",
      at: new Date().toISOString(),
      digest: reviewFingerprint(project, project.tests[0]!),
    };
    const response = await fetch(`${app.url}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-superq-token": state.token,
      },
      body: JSON.stringify({ revision: state.revision, project }),
    });
    assert.equal(response.status, 200);
    await page.goto(`${app.url}/#quality`);
    await page
      .getByRole("heading", { name: "Keep automation healthy." })
      .waitFor();
    await expect(
      page.getByRole("navigation", { name: "Automation capabilities" }),
    ).toBeVisible();
    await page
      .getByLabel("Enable bounded speculative healing for local runs")
      .check();
    await page.getByLabel("Original catalog locator").selectOption(original);
    await page
      .getByLabel("Catalog alternative", { exact: true })
      .selectOption(replacement);
    await page
      .getByRole("button", { name: "Save healing policy", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove mapping", exact: true })
      .waitFor();
    state = await (await fetch(`${app.url}/api/workspace`)).json();
    assert.deepEqual(state.project.healing.locators[original], [replacement]);
    await page
      .getByRole("button", { name: "Runs & reports", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Run a suite", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Suite", { exact: true }).selectOption("intake");
    await dialog
      .getByRole("button", { name: "Start run", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("link", { name: "Open report", exact: true })
      .first()
      .waitFor({ timeout: 15000 });
    await page
      .getByRole("button", { name: "Quality & maintenance", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Apply repair as draft", exact: true })
      .waitFor({ timeout: 15000 });
    state = await (await fetch(`${app.url}/api/workspace`)).json();
    assert.equal(state.runs[0].report.summary.healed, 1);
    assert.equal(state.runs[0].report.coverage.riskWeightedProven, 0);
    assert.ok(
      state.runs[0].report.gates.some((g: string) =>
        g.includes("Healed execution"),
      ),
    );
    await page
      .getByRole("button", { name: "Apply repair as draft", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Apply repair as draft", exact: true }),
    ).toBeDisabled();
    state = await (await fetch(`${app.url}/api/workspace`)).json();
    assert.equal(state.project.tests[0].status, "draft");
    assert.equal(state.project.tests[0].review, undefined);
    assert.deepEqual(
      state.project.tests[0].steps[0].assertions,
      project.tests[0]!.steps[0]!.assertions,
    );
    await page.getByRole("button", { name: /^Framework maintenance/ }).click();
    await page
      .getByRole("button", { name: "Run local framework checks", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Upgrade review checklist", exact: true })
      .waitFor();
    await expect(
      page.getByRole("cell", { name: "@playwright/test", exact: true }),
    ).toBeVisible();
    state = await (await fetch(`${app.url}/api/workspace`)).json();
    assert.ok(
      state.frameworkCheck.report.packages.every(
        (x: { status: string }) => x.status === "aligned",
      ),
    );
    if (process.env.SUPERQ_CAPTURE_STUDIO) {
      await mkdir("docs/images", { recursive: true });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: "docs/images/quality-care.png",
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    await new Promise<void>((r) => application.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
