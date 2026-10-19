import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { fixtureProject, fixtureInventory } from "./intake-fixtures.js";
import { attachSetup, orderSetups, inlineSetups } from "../src/web-setups.js";
import { setupImpact } from "../src/setup-impact.js";
import { Recipe, discover, materialize } from "../src/intake.js";
import { createAdapters } from "../src/adapters.js";
import { validateProject } from "../src/model.js";
import { run } from "../src/runner.js";
import { startWorkspace } from "../src/workspace-server.js";

async function fixture() {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    const part = req.url === "/one" ? "one," : req.url === "/two" ? "two," : "";
    res.end(
      `<p data-testid="status"></p><script>sessionStorage.setItem('order',(sessionStorage.getItem('order')||'')+${JSON.stringify(part)});document.querySelector('p').textContent=sessionStorage.getItem('order');</script>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
const recipe = () =>
  Recipe.parse({
    kind: "web",
    commands: [
      { type: "goto", path: "/check" },
      {
        type: "expectText",
        locator: { strategy: "testId", value: "status" },
        value: "one,two,",
        timeoutMs: 100,
      },
    ],
  });
function project(url: string) {
  const p = fixtureProject(url);
  p.webSetups = {
    first: { title: "First setup", commands: [{ type: "goto", path: "/one" }] },
    second: {
      title: "Second setup",
      commands: [{ type: "goto", path: "/two" }],
    },
  };
  return validateProject(p);
}

test("additive setup composition preserves order and case oracle through native execution and editable copies", async () => {
  const app = await fixture(),
    p = project(app.url),
    inventory = fixtureInventory();
  try {
    const attached = attachSetup(
      p,
      attachSetup(p, recipe(), "first"),
      "second",
    );
    assert.deepEqual(attached.kind === "web" && attached.setupIds, [
      "first",
      "second",
    ]);
    assert.deepEqual(attachSetup(p, attached, "second"), attached);
    const reversed = orderSetups(p, attached, ["second", "first"]);
    assert.throws(() => orderSetups(p, attached, ["first", "first"]), /once/);
    assert.throws(() => orderSetups(p, attached, ["first"]), /retain every/);
    assert.throws(() => attachSetup(p, attached, "unknown"), /Unknown/);
    const execute = async (mapping: Recipe) => {
      const plan = discover(p, "test", "web", inventory);
      plan.candidates[0]!.recipe = mapping;
      const generated = materialize(p, plan);
      generated.tests[0]!.status = "approved";
      const adapters = createAdapters();
      try {
        return (await run(generated, "test", "intake", adapters.registry))[0]!;
      } finally {
        await adapters.close();
      }
    };
    assert.equal((await execute(attached)).status, "passed");
    assert.equal((await execute(reversed)).status, "failed");
    const bounded = structuredClone(p);
    for (const id of ["third", "fourth", "fifth"])
      bounded.webSetups![id] = {
        title: id,
        commands: [{ type: "goto", path: `/${id}` }],
      };
    const four = attachSetup(
      bounded,
      attachSetup(bounded, attached, "third"),
      "fourth",
    );
    assert.throws(() => attachSetup(bounded, four, "fifth"), /4/);
    const large = structuredClone(p);
    large.webSetups!.first!.commands = Array.from({ length: 40 }, () => ({
      type: "goto" as const,
      path: "/one",
    }));
    large.webSetups!.second!.commands = Array.from({ length: 40 }, () => ({
      type: "goto" as const,
      path: "/two",
    }));
    large.webSetups!.third = {
      title: "Third",
      commands: Array.from({ length: 40 }, () => ({
        type: "goto" as const,
        path: "/three",
      })),
    };
    assert.throws(
      () => inlineSetups(large, attachSetup(large, attached, "third")),
      /100 commands/,
    );
    const expanded = inlineSetups(p, attached);
    assert.ok(expanded.kind === "web");
    assert.equal(expanded.setupIds, undefined);
    assert.deepEqual(
      expanded.commands.at(-1),
      recipe().kind === "web"
        ? (recipe() as Extract<Recipe, { kind: "web" }>).commands.at(-1)
        : undefined,
    );
    assert.equal((await execute(expanded)).status, "passed");
    assert.equal((await execute(inlineSetups(p, reversed))).status, "failed");
    assert.equal(p.webSetups!.first!.commands[0]!.type, "goto");
  } finally {
    await app.close();
  }
});

test("setup impact distinguishes direct review from transitive dependency blockers", () => {
  const p = project("http://127.0.0.1:1"),
    plan = discover(p, "test", "web", fixtureInventory());
  plan.candidates[0]!.recipe = attachSetup(p, recipe(), "first");
  const generated = materialize(p, plan),
    first = generated.tests[0]!;
  const second = structuredClone(first);
  second.id = "dependent";
  second.steps[0]!.input.setupIds = [];
  second.dependsOn = [first.id];
  const third = structuredClone(second);
  third.id = "nested-dependent";
  third.dependsOn = ["dependent"];
  generated.tests.push(second, third);
  assert.deepEqual(setupImpact(validateProject(generated), "first"), {
    referencingTests: [first.id],
    dependentTests: ["dependent", "nested-dependent"],
  });
  assert.deepEqual(setupImpact(generated, "unused"), {
    referencingTests: [],
    dependentTests: [],
  });
});

test("Studio attaches multiple setups, preserves no-op review, orders and expands them without changing the final expectation", async () => {
  const target = await fixture(),
    dir = await mkdtemp(join(tmpdir(), "superq-setup-order-")),
    app = await startWorkspace({ port: 0, file: join(dir, "state.json") }),
    browser = await chromium.launch();
  const get = async () =>
    await (await fetch(`${app.url}/api/workspace`)).json();
  const post = async (
    path: string,
    data: Record<string, unknown>,
    status = 200,
  ) => {
    const s = await get(),
      r = await fetch(`${app.url}/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superq-token": s.token,
        },
        body: JSON.stringify({ ...data, revision: s.revision }),
      });
    const output = await r.json();
    assert.equal(r.status, status, JSON.stringify(output));
    return output;
  };
  try {
    await post("import", { project: project(target.url) });
    await post("planning", { planning: fixtureInventory() });
    await post("intake/analyze", { environment: "test", preference: "web" });
    let state = await get();
    const candidateId = state.intake.candidates[0].id;
    await post("intake/map", { candidateId, patch: { recipe: recipe() } });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${app.url}/#intake`);
    await page
      .getByText("Optional: record a flow or ask AI for more tests", {
        exact: true,
      })
      .click();
    await page
      .getByText("Reusable browser setup flows", { exact: true })
      .click();
    await page
      .getByLabel("Existing setup", { exact: true })
      .selectOption("first");
    await page
      .getByRole("button", {
        name: "Add this setup to the mapped case",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await get()).intake.candidates[0].recipe.setupIds)
      .toEqual(["first"]);
    await page
      .getByLabel("Existing setup", { exact: true })
      .selectOption("second");
    await page
      .getByRole("button", {
        name: "Add this setup to the mapped case",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await get()).intake.candidates[0].recipe.setupIds)
      .toEqual(["first", "second"]);
    await post("intake/review", { reviewer: "QE" });
    state = await get();
    const before = structuredClone(state.intake.review),
      revision = state.revision;
    await post("setups/apply", { candidateId, id: "second" });
    state = await get();
    assert.deepEqual(state.intake.review, before);
    assert.equal(state.revision, revision);
    await post("setups/update", {
      id: "first",
      base: state.project.webSetups.first,
      definition: state.project.webSetups.first,
    });
    state = await get();
    assert.deepEqual(state.intake.review, before);
    assert.equal(state.revision, revision);
    await page
      .getByRole("button", { name: "Move setup first later", exact: true })
      .click();
    await expect
      .poll(async () => (await get()).intake.candidates[0].recipe.setupIds)
      .toEqual(["second", "first"]);
    assert.equal((await get()).intake.review, undefined);
    await expect(
      page.getByRole("button", {
        name: "Move setup first earlier",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Move setup first earlier", exact: true })
      .click();
    await expect
      .poll(async () => (await get()).intake.candidates[0].recipe.setupIds)
      .toEqual(["first", "second"]);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    if (process.env.SUPERQ_CAPTURE_STUDIO) {
      await expect
        .poll(async () => (await page.locator(".sidebar").boundingBox())!.x)
        .toBeLessThan(-200);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: "/tmp/superq-setup-order-mobile.png",
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page
      .getByRole("button", {
        name: "Make setup steps editable in this case",
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () => (await get()).intake.candidates[0].recipe.setupIds ?? [],
      )
      .toEqual([]);
    state = await get();
    assert.equal(state.intake.candidates[0].recipe.commands.length, 4);
    assert.equal(
      state.intake.candidates[0].recipe.commands.at(-1).value,
      "one,two,",
    );
    assert.equal(Object.keys(state.project.webSetups).length, 2);
    await post("intake/review", { reviewer: "QE" });
    await post("intake/generate", {});
    await post("intake/trial", {}, 202);
    await expect
      .poll(async () => (await get()).runs[0].state)
      .toBe("completed");
    state = await get();
    assert.equal(state.runs[0].report.summary.passed, 1);
    assert.deepEqual(errors, []);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  } finally {
    await browser.close();
    await app.close();
    await target.close();
    await rm(dir, { recursive: true, force: true });
  }
});
