import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { discoverRepository } from "../src/repository-discovery.js";
import { validateSnapshot } from "../src/knowledge.js";
import { fixtureProject } from "./intake-fixtures.js";
import { discover } from "../src/intake.js";
import { coordinate } from "../src/coordinator.js";
import { startWorkspace } from "../src/workspace-server.js";
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "superq-discovery-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "test@example.test");
  await mkdir(join(dir, "docs"));
  await mkdir(join(dir, "src"));
  await writeFile(
    join(dir, "README.md"),
    "Customers can create an order. See docs/orders.md.",
  );
  await writeFile(
    join(dir, "docs/orders.md"),
    "Orders require at least one item. https://external.invalid/spec",
  );
  await writeFile(join(dir, "src/orders.ts"), "export const minimumItems = 1;");
  git("add", ".");
  git("commit", "-qm", "Application");
  return { dir, git };
}
test("automatic discovery inventories docs/code, excludes unsafe and oversized content and reads only committed blobs", async () => {
  const { dir, git } = await fixture();
  try {
    await writeFile(join(dir, ".env"), "SECRET=value");
    await writeFile(join(dir, "docs/spec.pdf"), "not parsed");
    await writeFile(join(dir, "src/large.ts"), "x".repeat(65000));
    await symlink("README.md", join(dir, "linked.md"));
    git("add", ".");
    git("commit", "-qm", "Excluded content");
    await writeFile(join(dir, "README.md"), "uncommitted behavior");
    const before = git("status", "--porcelain");
    const result = await discoverRepository(dir);
    assert.equal(result.discovery.trackedFiles, 7);
    assert.equal(
      result.files.find((f) => f.path === "README.md")!.content,
      "Customers can create an order. See docs/orders.md.",
    );
    assert.deepEqual(
      result.discovery.included
        .filter((f) => f.kind === "documentation")
        .map((f) => f.path)
        .sort(),
      ["README.md", "docs/orders.md"].sort(),
    );
    for (const path of [".env", "docs/spec.pdf", "src/large.ts", "linked.md"])
      assert.ok(result.discovery.skipped.some((f) => f.path === path));
    assert.ok(!JSON.stringify(result).includes("SECRET=value"));
    assert.deepEqual(validateSnapshot(result), result);
    assert.equal(git("status", "--porcelain"), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("Studio connects with automatic discovery, displays docs and omissions, and rescans discover new documentation", async () => {
  const { dir, git } = await fixture();
  const app = await startWorkspace({
    port: 0,
    file: join(dir, "workspace.json"),
  });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const get = async () => (await fetch(`${app.url}/api/workspace`)).json();
  try {
    const initial = await get();
    const imported = await fetch(`${app.url}/api/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-superq-token": initial.token,
      },
      body: JSON.stringify({
        revision: initial.revision,
        project: fixtureProject(),
      }),
    });
    assert.equal(imported.status, 200);
    await page.goto(`${app.url}/#intake`);
    await page
      .getByRole("button", { name: "Connect repository", exact: true })
      .click();
    await page.getByLabel("Repository folder", { exact: true }).fill(dir);
    await expect(
      page.getByLabel(
        "Discover application code and documentation automatically",
      ),
    ).toBeChecked();
    const request = page.waitForRequest((r) =>
      r.url().endsWith("/api/intake/connect"),
    );
    await page
      .getByRole("button", { name: "Connect & scan", exact: true })
      .click();
    assert.equal((await request).postDataJSON().autoDiscover, true);
    await page
      .getByText(/Repository analysis scope · 2 documents discovered/)
      .click();
    await expect(
      page.getByText("docs/orders.md · documentation", { exact: true }),
    ).toBeVisible();
    let state = await get();
    assert.equal(state.sourceSnapshot.files.length, 3);
    assert.equal(state.connections.autoDiscover, true);
    await writeFile(
      join(dir, "docs/accounts.md"),
      "An account is required for checkout.",
    );
    git("add", "docs/accounts.md");
    git("commit", "-qm", "Account documentation");
    const scan = await fetch(`${app.url}/api/scan`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-superq-token": state.token,
      },
      body: JSON.stringify({ revision: state.revision }),
    });
    assert.equal(scan.status, 200, await scan.text());
    state = await get();
    assert.ok(
      state.sourceSnapshot.files.some(
        (f: { path: string }) => f.path === "docs/accounts.md",
      ),
    );
    assert.ok(state.connections.paths.includes("docs/accounts.md"));
    await page.reload();
    await page
      .getByText(/Repository analysis scope · 3 documents discovered/)
      .click();
    if (process.env.SUPERQ_CAPTURE_DISCOVERY) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: "/tmp/superq-discovery-desktop.png",
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  } finally {
    await browser.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("AI analysis receives discovered documentation as cited evidence with explicit scope", async () => {
  const { dir } = await fixture();
  try {
    const snapshot = await discoverRepository(dir);
    const project = fixtureProject();
    const plan = discover(project, "test", "api", undefined, snapshot);
    const job = coordinate(
      project,
      plan,
      undefined,
      snapshot,
      "fixture",
      async (role, _schema, prompt) => {
        const { context, instruction } = JSON.parse(prompt);
        assert.ok(
          context.repositoryScope.documentation.includes("docs/orders.md"),
        );
        assert.ok(
          context.snapshot.files.some(
            (f: { path: string; content: string }) =>
              f.path === "docs/orders.md" &&
              f.content.includes("at least one item"),
          ),
        );
        assert.match(
          instruction,
          /conflicts between documented expectations and code/,
        );
        if (role === "analyst")
          return {
            functionality: [
              {
                name: "Order item minimum",
                source: "docs/orders.md",
                revision: snapshot.revision,
                excerpt: "Orders require at least one item.",
              },
            ],
            gaps: [],
            questions: [],
          };
        if (role === "designer") return { proposals: [] };
        return { accepted: [], issues: [] };
      },
    );
    await job.done;
    assert.equal(job.job.state, "completed");
    assert.equal(
      job.job.analysis?.functionality?.[0]?.source,
      "docs/orders.md",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
