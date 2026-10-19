import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startWorkspace } from "../src/workspace-server.js";
test("Studio guides setup, change review, test editing and real focused execution; supports mobile navigation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-studio-"));
  const app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1050 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(app.url);
    await page
      .getByRole("heading", {
        name: "A little less effort. A lot more confidence.",
      })
      .waitFor();
    assert.equal(
      await page
        .getByText("Interactive sample project", { exact: true })
        .isVisible(),
      true,
    );
    await page.getByRole("button", { name: /Change inbox/ }).click();
    await page
      .getByRole("heading", { name: "Every change, understood." })
      .waitFor();
    await page.getByRole("button", { name: /TC-102 Customer sees/ }).click();
    assert.ok(await page.getByText("checkout.submit", { exact: true }).count());
    await page
      .getByRole("button", { name: "Stage all as drafts", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Stage as draft", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    const state = await (await fetch(`${app.url}/api/workspace`)).json();
    assert.equal(state.project.tests[0].status, "draft");
    assert.ok(
      state.plan.items.every((i: { status: string }) => i.status === "staged"),
    );
    await page
      .getByRole("button", { name: "Test library", exact: true })
      .click();
    await page.getByRole("button", { name: /TC-101 Place an order/ }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByText("Record a human review of the saved version", { exact: true })
      .click();
    await dialog
      .getByLabel("Reviewer name", { exact: true })
      .fill("Fixture reviewer");
    await dialog
      .getByRole("button", { name: "Record review of saved test", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: /TC-101 Place an order/ }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Code", exact: true }).click();
    const editor = dialog.getByLabel(/Advanced test definition/);
    const definition = JSON.parse(await editor.inputValue());
    definition.title = "Updated checkout intent";
    await editor.fill(JSON.stringify(definition));
    await dialog
      .getByRole("button", { name: "Save test as draft", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByText("Updated checkout intent", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Create a test", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("What should this test prove?", { exact: true })
      .fill("Inventory remains available");
    await dialog
      .getByLabel("Requirement", { exact: true })
      .selectOption("REQ-104");
    await dialog
      .getByLabel("Inventory availability matches the catalog", { exact: true })
      .check();
    await dialog
      .getByRole("button", { name: "Add a reusable action", exact: true })
      .click();
    assert.equal(
      await dialog.getByLabel("Request path", { exact: true }).inputValue(),
      "api/inventory",
    );
    await dialog
      .getByText("Advanced action inputs (JSON)", { exact: true })
      .click();
    await dialog.getByLabel(/Action inputs/).fill("{invalid");
    await expect(
      dialog.getByRole("button", { name: "Save test as draft", exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel(/Action inputs/).fill('{"path":"api/inventory"}');
    await dialog
      .getByRole("button", { name: "Save test as draft", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByText("Inventory remains available", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Runs & reports", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Run a suite", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel(/TC-105 · Verify available inventory/).check();
    await dialog
      .getByRole("button", { name: "Start run", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("link", { name: "Open report", exact: true })
      .first()
      .waitFor({ timeout: 15000 });
    assert.ok(await page.getByText(/1\/1 passed/).count());
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Coverage map", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Coverage with context." })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Studio imports sprint intake and preserves executable coverage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-intake-"));
  const app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${app.url}/#planning`);
    await page
      .getByRole("heading", {
        name: "Test intake & sprint planning",
        exact: true,
      })
      .waitFor();
    const before = await (await fetch(`${app.url}/api/workspace`)).json();
    const payload = {
      team: "Payments QE",
      sprint: "Sprint 42",
      cases: [
        {
          source: "ADO",
          externalId: "100",
          revision: "1",
          title: "Historical payment",
          featureIds: ["unknown"],
          steps: [{ action: "Pay", expected: "Confirmed" }],
          dependsOn: ["ADO:missing"],
        },
      ],
    };
    await page
      .getByLabel("Planning package JSON")
      .fill(JSON.stringify(payload));
    await page.getByRole("button", { name: "Save & review intake" }).click();
    await page.getByText("Payments QE · Sprint 42", { exact: true }).waitFor();
    await page
      .getByRole("heading", { name: "ADO:100 · Historical payment" })
      .waitFor();
    assert.ok(
      await page.getByText(/Import the missing prerequisite/).isVisible(),
    );
    const after = await (await fetch(`${app.url}/api/workspace`)).json();
    assert.equal(after.planning.cases[0].externalId, "100");
    assert.deepEqual(after.project, before.project);
    assert.deepEqual(after.coverage, before.coverage);
    await page.reload();
    await page.getByText("Payments QE · Sprint 42", { exact: true }).waitFor();
  } finally {
    await browser.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Coverage Lab generates constrained data, saves the model and keeps proof unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-design-"));
  const file = join(dir, "state.json");
  const app = await startWorkspace({ port: 0, file });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto(`${app.url}/#design`);
    await page
      .getByRole("heading", { name: "Coverage Lab", exact: true })
      .waitFor();
    const before = await (await fetch(`${app.url}/api/workspace`)).json();
    await page.getByLabel("Source document or story").fill("ED/checkout");
    await page.getByLabel("Source revision").fill("7");
    await page
      .getByLabel("Relevant rule or excerpt")
      .fill("Checkout supports browser, customer and payment combinations.");
    await page
      .getByLabel("Forbidden combinations")
      .fill('[{"customer":"Guest","payment":"Wallet"}]');
    await page.getByRole("button", { name: "Generate pairwise data" }).click();
    await page.getByRole("heading", { name: "Review your dataset" }).waitFor();
    assert.ok((await page.locator("tbody tr").count()) < 9);
    await page
      .getByRole("button", { name: "Save design", exact: true })
      .click();
    await page.getByText("Coverage design saved", { exact: true }).waitFor();
    const after = await (await fetch(`${app.url}/api/workspace`)).json();
    assert.equal(after.testDesign.evidence.revision, "7");
    const stale = await fetch(`${app.url}/api/test-design`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-superq-token": after.token,
      },
      body: JSON.stringify({
        revision: after.revision,
        baseDesign: null,
        design: { ...after.testDesign, title: "Stale overwrite" },
      }),
    });
    assert.equal(stale.status, 409);
    assert.deepEqual(after.project, before.project);
    assert.deepEqual(after.coverage, before.coverage);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export model & data" }).click();
    assert.equal(
      (await download).suggestedFilename(),
      "superq-pairwise-design.json",
    );
    await page.reload();
    await expect(page.getByLabel("Source revision")).toHaveValue("7");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar")!.getBoundingClientRect().right <= 0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  } finally {
    await browser.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
