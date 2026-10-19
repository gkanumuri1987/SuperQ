import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { discoverRepository } from "../src/repository-discovery.js";
import { previewModule, suggestedDocuments } from "../src/module-scope.js";
import { startWorkspace } from "../src/workspace-server.js";
import { discover } from "../src/intake.js";
import { fixtureProject, fixtureInventory } from "./intake-fixtures.js";
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "superq-modules-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "test@example.test");
  for (const path of ["src/orders", "src/orders-admin", "src/accounts", "docs"])
    await mkdir(join(dir, path), { recursive: true });
  for (const [path, content] of Object.entries({
    "README.md": "Application overview",
    "docs/orders.md": "Orders need an item",
    "docs/accounts.md": "Accounts need a name",
    "src/orders/create.ts": "export const minimum = 1;",
    "src/orders-admin/admin.ts": "export const admin = true;",
    "src/accounts/login.ts": "export const login = true;",
  }))
    await writeFile(join(dir, path), content);
  git("add", ".");
  git("commit", "-qm", "Modules");
  return { dir, git };
}
test("focused discovery uses exact module boundaries, selected docs and predictable budget limits", async () => {
  const { dir } = await fixture();
  try {
    const all = await discoverRepository(dir);
    const inventory = all.discovery.inventory!;
    const scope = {
      module: "src/orders",
      documents: suggestedDocuments(inventory, "src/orders"),
    };
    assert.deepEqual(
      scope.documents.sort(),
      ["README.md", "docs/orders.md"].sort(),
    );
    const focused = await discoverRepository(dir, scope);
    assert.deepEqual(
      focused.files.map((f) => f.path).sort(),
      ["README.md", "docs/orders.md", "src/orders/create.ts"].sort(),
    );
    assert.deepEqual(
      previewModule(inventory, scope)
        .included.map((f) => f.path)
        .sort(),
      focused.files.map((f) => f.path).sort(),
    );
    const scopedPlan = discover(
      fixtureProject(),
      "test",
      "api",
      fixtureInventory(),
      focused,
    );
    assert.ok(scopedPlan.candidates.length > 0);
    assert.ok(scopedPlan.candidates.every((c) => !c.selected));
    assert.ok(
      scopedPlan.candidates.some((c) =>
        c.questions.some((q) => q.includes("active module context")),
      ),
    );
    assert.ok(
      focused.discovery.skipped.some(
        (f) => f.path === "src/orders-admin/admin.ts",
      ),
    );
    await assert.rejects(
      () => discoverRepository(dir, { module: "../orders", documents: [] }),
      /Choose a module/,
    );
    await assert.rejects(
      () =>
        discoverRepository(dir, {
          module: "src/orders",
          documents: ["src/accounts/login.ts"],
        }),
      /Choose documentation/,
    );
    const bounded = previewModule(
      [
        { path: "src/orders/large.ts", kind: "source", bytes: 65000 },
        ...inventory,
      ],
      scope,
    );
    assert.ok(bounded.deferred.some((f) => f.path.endsWith("large.ts")));
    assert.ok(bounded.bytes <= 64000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("Studio previews a module, saves its actual scope, rejects changed evidence atomically and restores overview", async () => {
  const { dir, git } = await fixture();
  const app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const get = async () => (await fetch(`${app.url}/api/workspace`)).json();
  const post = async (path: string, data: object) => {
    const state = await get();
    return fetch(`${app.url}/api/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-superq-token": state.token,
      },
      body: JSON.stringify({ ...data, revision: state.revision }),
    });
  };
  try {
    assert.equal(
      (await post("import", { project: fixtureProject() })).status,
      200,
    );
    assert.equal(
      (
        await post("intake/connect", {
          environment: "test",
          baseURL: "https://test.example.test",
          localRepository: dir,
          autoDiscover: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (await post("intake/analyze", { environment: "test", preference: "api" }))
        .status,
      200,
    );
    const before = await get();
    await page.goto(`${app.url}/#intake`);
    await page.getByRole("button", { name: "1 Connect", exact: true }).click();
    await page.getByText("Focus on a module", { exact: true }).click();
    await page.getByLabel("Module to analyze").selectOption("src/orders");
    await page.getByText("Files to load", { exact: true }).click();
    const preview = page.getByRole("region", { name: "Module scope preview" });
    await expect(
      preview.getByText("src/orders/create.ts · source", { exact: true }),
    ).toBeVisible();
    await expect(preview.getByText(/orders-admin/)).toHaveCount(0);
    const request = page.waitForRequest((r) =>
      r.url().endsWith("/api/intake/focus"),
    );
    await page
      .getByRole("button", { name: "Use this module", exact: true })
      .click();
    assert.deepEqual((await request).postDataJSON().scope, {
      module: "src/orders",
      documents: ["README.md", "docs/orders.md"],
    });
    await expect
      .poll(async () => (await get()).connections.analysisScope?.module)
      .toBe("src/orders");
    let state = await get();
    assert.deepEqual(state.project.tests, before.project.tests);
    assert.equal(state.intakeStatus.stale, true);
    const savedFiles = state.sourceSnapshot.files;
    await writeFile(
      join(dir, "src/orders/new.ts"),
      "export const another = true;",
    );
    git("add", "src/orders/new.ts");
    git("commit", "-qm", "New orders flow");
    const rejected = await post("intake/focus", {
      scope: { module: "src/accounts", documents: [] },
      sourceRevision: state.sourceSnapshot.revision,
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual((await get()).sourceSnapshot.files, savedFiles);
    assert.equal((await post("scan", {})).status, 200);
    state = await get();
    assert.ok(
      state.sourceSnapshot.files.some(
        (f: { path: string }) => f.path === "src/orders/new.ts",
      ),
    );
    assert.ok(
      !state.sourceSnapshot.files.some((f: { path: string }) =>
        f.path.startsWith("src/accounts/"),
      ),
    );
    await page.reload();
    await page
      .getByText("Focus on a module · src/orders", { exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    if (process.env.SUPERQ_CAPTURE_MODULE) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: "/tmp/superq-module-mobile.png",
        fullPage: true,
        animations: "disabled",
      });
    }
    await page
      .getByRole("button", {
        name: "Return to repository overview",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await get()).connections.analysisScope ?? null)
      .toBe(null);
    assert.ok(
      (await get()).sourceSnapshot.files.some(
        (f: { path: string }) => f.path === "src/accounts/login.ts",
      ),
    );
  } finally {
    await browser.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
