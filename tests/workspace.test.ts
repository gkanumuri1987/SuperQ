import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWorkspace } from "../src/workspace-server.js";
test("local workspace rejects cross-site/stale writes, persists reviewed drafts and exposes coverage changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-workspace-"));
  const app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
  try {
    let state = await (await fetch(`${app.url}/api/workspace`)).json();
    const post = (path: string, value: unknown, token = state.token) =>
      fetch(`${app.url}/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superq-token": token,
        },
        body: JSON.stringify(value),
      });
    assert.equal(
      (await post("stage", { revision: state.revision, ids: [] }, "wrong"))
        .status,
      403,
    );
    assert.equal((await post("stage", { revision: 0, ids: [] })).status, 409);
    assert.equal(
      (
        await post("runs", {
          revision: state.revision,
          environment: "sample",
          suite: "regression",
          profile: "local",
          workers: 1,
        })
      ).status,
      400,
    );
    const ids = state.plan.items.map((i: { id: string }) => i.id);
    assert.equal(
      (await post("stage", { revision: state.revision, ids })).status,
      200,
    );
    state = await (await fetch(`${app.url}/api/workspace`)).json();
    assert.ok(
      state.plan.items.every((i: { status: string }) => i.status === "staged"),
    );
    assert.equal(state.project.tests[0].status, "draft");
    assert.ok(
      state.coverage.rows[0].gaps.includes("uncovered-acceptance-criteria"),
    );
    assert.equal(
      (
        await post("approve", {
          revision: state.revision,
          testId: "TC-101",
          reviewer: "Fixture reviewer",
        })
      ).status,
      200,
    );
    state = await (await fetch(`${app.url}/api/workspace`)).json();
    assert.equal(state.project.tests[0].status, "approved");
    assert.ok(state.project.tests[0].review.digest);
    const sample = await fetch(`${app.url}/sample-app/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"items":["fixture"]}',
    });
    assert.equal((await sample.json()).status, "confirmed");
    assert.equal(
      (await post("sample-version", { revision: state.revision, version: 2 }))
        .status,
      200,
    );
    const changed = await fetch(`${app.url}/sample-app/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"items":["fixture"]}',
    });
    assert.equal((await changed.json()).status, "placed");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("committed source changes and deletions notify mapped tests without inventing assertions or modifying the app repo", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "superq-source-"));
  const repo = join(dir, "application");
  await mkdir(join(repo, "specs"), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  git("init");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(
    join(repo, "specs/checkout.md"),
    "Old checkout specification",
  );
  git("add", ".");
  git("commit", "-m", "baseline");
  const app = await startWorkspace({
    port: 0,
    file: join(dir, "workspace.json"),
  });
  try {
    let state = await (await fetch(`${app.url}/api/workspace`)).json();
    const post = async (path: string, data: Record<string, unknown>) => {
      const response = await fetch(`${app.url}/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superq-token": state.token,
        },
        body: JSON.stringify({ revision: state.revision, ...data }),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      state = await (await fetch(`${app.url}/api/workspace`)).json();
    };
    await post("setup", {
      name: state.project.name,
      baseURL: state.project.environments.sample.baseURL,
      repository: "",
      tracker: "",
      documentation: "",
      localRepository: repo,
      paths: ["specs/checkout.md"],
      watch: false,
    });
    await post("scan", {});
    await writeFile(
      join(repo, "specs/checkout.md"),
      "New business behavior requires interpretation",
    );
    git("add", ".");
    git("commit", "-m", "new behavior");
    await post("scan", {});
    assert.equal(state.plan.source, "source-scan");
    assert.equal(state.project.tests[0].status, "draft");
    assert.equal(
      state.project.tests[0].steps[0].assertions[1].expected,
      "confirmed",
    );
    assert.equal(git("status", "--porcelain").trim(), "");
    await post("stage", {
      ids: state.plan.items.map((i: { id: string }) => i.id),
    });
    await rm(join(repo, "specs/checkout.md"));
    git("add", ".");
    git("commit", "-m", "retire source");
    await post("scan", {});
    assert.ok(state.plan.candidate.evidence[0].excerpt.includes("removed"));
    assert.equal(state.project.tests[0].status, "draft");
    assert.equal(git("status", "--porcelain").trim(), "");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("draft validation is exploratory and editing/re-review cannot reuse a stale passing report", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-evidence-ui-"));
  const app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
  try {
    let state = await (await fetch(`${app.url}/api/workspace`)).json();
    const refresh = async () => {
      state = await (await fetch(`${app.url}/api/workspace`)).json();
    };
    const post = async (path: string, value: Record<string, unknown>) => {
      const response = await fetch(`${app.url}/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superq-token": state.token,
        },
        body: JSON.stringify({ revision: state.revision, ...value }),
      });
      assert.ok(response.ok, await response.text());
      await refresh();
    };
    const waitRun = async () => {
      for (let i = 0; i < 100 && state.runs[0].state === "running"; i++) {
        await new Promise((r) => setTimeout(r, 30));
        await refresh();
      }
      assert.equal(state.runs[0].state, "completed");
    };
    await post("stage", {
      ids: state.plan.items.map((i: { id: string }) => i.id),
    });
    await post("sample-version", { version: 2 });
    await post("runs", {
      environment: "sample",
      suite: "regression",
      profile: "local",
      workers: 1,
      testIds: ["TC-101"],
      validateDrafts: true,
    });
    await waitRun();
    assert.equal(state.runs[0].draftValidation, true);
    assert.equal(state.runs[0].report.summary.passed, 1);
    assert.equal(state.project.tests[0].status, "draft");
    assert.equal(state.coverage.rows[0].proven, false);
    await post("approve", { testId: "TC-105", reviewer: "Fixture reviewer" });
    await post("runs", {
      environment: "sample",
      suite: "regression",
      profile: "local",
      workers: 1,
      testIds: ["TC-105"],
    });
    await waitRun();
    assert.equal(
      state.coverage.rows.find(
        (r: { requirementId: string }) => r.requirementId === "REQ-104",
      ).proven,
      true,
    );
    const changed = structuredClone(state.project);
    changed.tests.find((t: { id: string }) => t.id === "TC-105").title =
      "Changed intent needs a new run";
    await post("project", { project: changed });
    await post("approve", { testId: "TC-105", reviewer: "Fixture reviewer" });
    assert.equal(
      state.coverage.rows.find(
        (r: { requirementId: string }) => r.requirementId === "REQ-104",
      ).proven,
      false,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
