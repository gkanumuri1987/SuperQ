import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startWorkspace } from "../src/workspace-server.js";
import { fixtureProject } from "./intake-fixtures.js";

test("active Studio guides manual paste through plan review, real browser trial, diagnostics and MCP access at desktop/mobile widths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-intake-studio-"));
  const app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1480, height: 1050 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    let state = await (await fetch(`${app.url}/api/workspace`)).json();
    const response = await fetch(`${app.url}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-superq-token": state.token,
      },
      body: JSON.stringify({
        revision: state.revision,
        project: fixtureProject(`${app.url}/sample-app/`),
      }),
    });
    assert.equal(response.status, 200);
    await page.goto(`${app.url}/#intake`);
    await page
      .getByRole("heading", { name: "Let’s automate your application." })
      .waitFor();
    await page
      .getByRole("button", { name: "Add manual cases", exact: true })
      .click();
    await page.getByRole("button", { name: "Paste spreadsheet rows" }).click();
    await page
      .getByLabel("Paste rows from your spreadsheet")
      .fill(
        "TC-1\tPlace an order\tOpen checkout and click Place order\tOrder confirmed",
      );
    await page
      .getByRole("button", { name: "Import current-scope cases" })
      .click();
    await page.getByText("1 case imported", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Continue to test cases" }).click();
    await page
      .getByRole("heading", { name: "Review your automation plan" })
      .waitFor();
    await expect(
      page.getByRole("button", { name: "Approve plan for automation" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Map actions & assertions" })
      .click();
    await page
      .getByLabel("Application path", { exact: true })
      .fill("/sample-app");
    await page
      .getByLabel("Exact label / ID / text", { exact: true })
      .fill("Order confirmed");
    await page
      .getByLabel("Expected visible text", { exact: true })
      .fill("Order confirmed");
    await page.getByRole("button", { name: "Add click", exact: true }).click();
    await page
      .getByLabel("Accessible name", { exact: true })
      .fill("Place order");
    await page.getByLabel("Explicitly anonymous test").check();
    await page.getByRole("button", { name: "Save mapping for review" }).click();
    await page
      .getByLabel("QE reviewer", { exact: true })
      .fill("Studio fixture QE");
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
    await page
      .getByRole("heading", { name: "Verify in the application" })
      .waitFor();
    await page.getByRole("button", { name: "Run local draft trial" }).click();
    await page
      .getByText("Place an order: passed", { exact: true })
      .waitFor({ timeout: 15000 });
    state = await (await fetch(`${app.url}/api/workspace`)).json();
    assert.equal(state.project.tests[0].status, "draft");
    assert.equal(state.runs[0].draftValidation, true);
    assert.equal(state.runs[0].report.results[0].observations.length, 4);
    await page
      .getByText("Advanced: connect a corporate coding agent", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Enable proposal-only MCP connection" })
      .click();
    await page.getByText("Proposals only", { exact: true }).waitFor();
    assert.ok(await page.getByLabel("Private connection file").inputValue());
    await page.getByRole("button", { name: "Revoke agent connection" }).click();
    if (process.env.SUPERQ_CAPTURE_STUDIO) {
      await mkdir("docs/images", { recursive: true });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: "docs/images/intake.png", fullPage: true });
    }
    await page.goto(`${app.url}/#runs`);
    await page.getByRole("heading", { name: "Your test results." }).waitFor();
    await page
      .getByRole("button", { name: "Email summary", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open email draft", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Enter email addresses",
    );
    await page.getByLabel("Recipients", { exact: true }).fill("qe@example.com");
    const mail = new URL(
      (await page
        .getByRole("link", { name: "Open email draft" })
        .getAttribute("href"))!,
    );
    assert.equal(mail.protocol, "mailto:");
    assert.ok(mail.searchParams.get("body")!.includes(state.runs[0].id));
    assert.ok(mail.searchParams.get("body")!.includes("Draft trial"));
    assert.ok(!mail.searchParams.get("body")!.includes("Place an order"));
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download summary text" }).click();
    const download = await downloadPromise;
    assert.equal(
      download.suggestedFilename(),
      `superq-summary-${state.runs[0].id}.txt`,
    );
    const reportURL = await page
      .getByRole("link", { name: "Download full report" })
      .getAttribute("href");
    const reportResponse = await fetch(`${app.url}${reportURL}`);
    assert.equal(reportResponse.status, 200);
    assert.match(await reportResponse.text(), /Place an order/);
    await page.getByLabel("Show results").selectOption("all");
    await expect(
      page.getByRole("heading", { name: "Place an order", exact: true }),
    ).toBeVisible();
    if (process.env.SUPERQ_CAPTURE_STUDIO) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        animations: "disabled",
        path: "docs/images/tester-results.png",
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    }));
    assert.ok(
      width.scroll <= width.width + 1,
      `Mobile overflow: ${JSON.stringify(width)}`,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("functional tester writes a multiline case without spreadsheet syntax", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-write-case-"));
  const app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`${app.url}/#intake`);
    await page
      .getByRole("button", { name: "Add manual cases", exact: true })
      .click();
    await page
      .getByLabel("Test name", { exact: true })
      .fill("Customer signs in");
    await page
      .getByLabel("Action", { exact: true })
      .fill("Enter email\nand password");
    await page
      .getByLabel("Expected result", { exact: true })
      .fill("Dashboard shows\tthe customer name");
    await page.getByRole("button", { name: "Add a step", exact: true }).click();
    await page
      .getByRole("group", { name: "Step 2", exact: true })
      .getByRole("textbox", { name: /^Action/ })
      .fill("Sign out");
    await page
      .getByRole("group", { name: "Step 2", exact: true })
      .getByRole("textbox", { name: /^Expected result/ })
      .fill("Sign in page appears");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    if (process.env.SUPERQ_CAPTURE_STUDIO) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        animations: "disabled",
        path: "docs/images/write-test-mobile.png",
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "Save test case", exact: true })
      .click();
    await page.getByText("1 case imported", { exact: true }).waitFor();
    const state = await (await fetch(`${app.url}/api/workspace`)).json();
    const saved = state.planning.cases.find(
      (c: { title: string }) => c.title === "Customer signs in",
    );
    assert.deepEqual(saved.steps, [
      {
        action: "Enter email\nand password",
        expected: "Dashboard shows\tthe customer name",
      },
      { action: "Sign out", expected: "Sign in page appears" },
    ]);
    assert.ok(saved.externalId.startsWith("manual-"));
    assert.equal(state.runs.length, 0);
  } finally {
    await browser.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
