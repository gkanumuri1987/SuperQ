import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { discover, proposeCase, materialize } from "../src/intake.js";
import { fixtureProject, fixtureInventory } from "./intake-fixtures.js";
import { startWorkspace } from "../src/workspace-server.js";
function fixture() {
  const p = fixtureProject();
  p.evidence = [
    { id: "E", source: "ED", revision: "1", excerpt: "Health shows Ready" },
  ];
  p.requirements = [
    {
      id: "R",
      title: "Service availability",
      risk: "critical",
      evidenceIds: ["E"],
      criteria: [{ id: "ready", title: "Health shows Ready" }],
    },
  ];
  return p;
}
const proposal = {
  title: "Ready response contract",
  requirementId: "R",
  criterionId: "ready",
  steps: [{ action: "Request health", expected: "Health shows Ready" }],
  evidence: [{ source: "ED", revision: "1", excerpt: "Health shows Ready" }],
  recipe: {
    kind: "api" as const,
    requests: [
      {
        path: "/health",
        method: "GET" as const,
        assertions: [
          {
            path: "body.status",
            operator: "equals" as const,
            expected: "Ready",
          },
        ],
      },
    ],
  },
};
test("AI proposals retain existing criterion and risk; invalid or unsupported links fail without partial mutation", () => {
  const p = fixture(),
    plan = discover(p, "test", "api");
  const before = structuredClone(plan);
  for (const bad of [
    { ...proposal, criterionId: "unknown" },
    { ...proposal, requirementId: undefined },
    { ...proposal, requirementId: "unknown" },
    {
      ...proposal,
      evidence: [{ source: "unrelated", revision: "1", excerpt: "Other" }],
    },
  ])
    assert.throws(() => proposeCase(plan, p, bad));
  assert.deepEqual(plan, before);
  proposeCase(plan, p, proposal);
  plan.candidates.forEach((c) => (c.selected = c.title === proposal.title));
  const generated = materialize(p, plan);
  assert.deepEqual(generated.requirements, p.requirements);
  assert.deepEqual(generated.tests[0]!.covers, { R: ["ready"] });
  assert.equal(generated.tests[0]!.status, "draft");
});
test("Studio coverage selection sends exact criterion, clears plan review, preserves risk and rejects invalid API links atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "superq-coverage-links-"));
  const app = await startWorkspace({
    port: 0,
    file: join(directory, "state.json"),
  });
  const browser = await chromium.launch(),
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
    await post("import", { project: fixture() });
    await post("planning", { planning: fixtureInventory() });
    await post("intake/analyze", { environment: "test", preference: "api" });
    let state = await get();
    const candidate = state.intake.candidates.find(
      (c: { title: string }) => c.title === "Service health",
    );
    assert.ok(candidate);
    await page.goto(`${app.url}/#intake`);
    const selection = page.getByRole("combobox", {
      name: "Coverage target for Service health",
      exact: true,
    });
    const request = page.waitForRequest(
      (r) => r.url().endsWith("/api/intake/map") && r.method() === "POST",
    );
    await selection.selectOption(JSON.stringify(["R", "ready"]));
    assert.deepEqual((await request).postDataJSON().patch.coverage, {
      requirementId: "R",
      criterionId: "ready",
    });
    await expect
      .poll(
        async () =>
          (await get()).intake.candidates.find(
            (c: { id: string }) => c.id === candidate.id,
          ).requirementId,
      )
      .toBe("R");
    state = await get();
    assert.equal(state.intake.review, undefined);
    if (process.env.SUPERQ_CAPTURE_STUDIO)
      await page
        .getByRole("region", {
          name: "Coverage target for Service health",
          exact: true,
        })
        .screenshot({ path: "/tmp/superq-coverage-link-desktop.png" });
    const before = structuredClone(state.intake);
    await post(
      "intake/map",
      {
        candidateId: candidate.id,
        patch: {
          selected: false,
          coverage: { requirementId: "R", criterionId: "bad" },
        },
      },
      400,
    );
    assert.deepEqual((await get()).intake, before);
    await post("intake/map", {
      candidateId: candidate.id,
      patch: { recipe: proposal.recipe },
    });
    state = await get();
    for (const c of state.intake.candidates)
      if (c.id !== candidate.id)
        await post("intake/map", {
          candidateId: c.id,
          patch: { selected: false },
        });
    await post("intake/review", { reviewer: "QE" });
    await post("intake/map", {
      candidateId: candidate.id,
      patch: { coverage: { requirementId: "R", criterionId: "ready" } },
    });
    assert.equal((await get()).intake.review, undefined);
    await post("intake/review", { reviewer: "QE" });
    await post("intake/generate", {});
    state = await get();
    assert.equal(state.project.requirements.length, 1);
    assert.equal(state.project.requirements[0].risk, "critical");
    assert.deepEqual(state.project.tests[0].covers, { R: ["ready"] });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page
      .getByRole("button", { name: "2 Review tests", exact: true })
      .click();
    await expect(selection).toBeVisible();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    if (process.env.SUPERQ_CAPTURE_STUDIO)
      await page.screenshot({
        path: "/tmp/superq-coverage-link-mobile.png",
        fullPage: true,
      });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
