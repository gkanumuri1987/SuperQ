import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceAgentCall } from "../src/mcp-server.js";
import { startWorkspace } from "../src/workspace-server.js";
import {
  fixtureInventory,
  fixtureProject,
  fixtureSnapshot,
} from "./intake-fixtures.js";

test("real read-only Git intake generates API tests, combines inventory, persists review and blocks stale-source trials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-repo-intake-")),
    repo = join(dir, "app");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  git("init");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  const contract = JSON.parse(fixtureSnapshot().files[0]!.content);
  contract.paths["/sample-app/api/health"] = contract.paths["/api/health"];
  delete contract.paths["/api/health"];
  await writeFile(join(repo, "openapi.json"), JSON.stringify(contract));
  git("add", ".");
  git("commit", "-m", "contract");
  const original = git("rev-parse", "HEAD");
  let app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
  try {
    let state = await (await fetch(`${app.url}/api/workspace`)).json();
    const refresh = async () => {
      state = await (await fetch(`${app.url}/api/workspace`)).json();
    };
    const post = async (
      path: string,
      input: Record<string, unknown>,
      expected = 200,
    ) => {
      const response = await fetch(`${app.url}/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superq-token": state.token,
        },
        body: JSON.stringify({ revision: state.revision, ...input }),
      });
      const body = await response.json();
      assert.equal(response.status, expected, JSON.stringify(body));
      await refresh();
      return body;
    };
    const configured = fixtureProject(`${app.url}/`);
    configured.execution.includeTags = ["unrelated-selection"];
    configured.execution.shard = { index: 2, total: 2 };
    await post("import", { project: configured });
    await post("setup", {
      name: state.project.name,
      baseURL: `${app.url}/`,
      repository: "https://example.invalid/read-only",
      tracker: "",
      documentation: "",
      localRepository: repo,
      paths: ["openapi.json"],
      watch: false,
    });
    await post("scan", {});
    await post("agent-access", { enabled: true, allowTrials: false });
    const callAgent = workspaceAgentCall(state.agentConnection.file);
    const shared = (await callAgent("context")) as {
      sources: {
        revision: string;
        files: { path: string; content?: string }[];
      };
    };
    assert.equal(shared.sources.files[0]!.content, undefined);
    const source = (await callAgent("source", {
      path: "openapi.json",
      sourceRevision: shared.sources.revision,
    })) as { content: string };
    assert.equal(source.content, JSON.stringify(contract));
    await assert.rejects(
      callAgent("source", { path: "../state.json", sourceRevision: original }),
      /explicitly scanned/,
    );
    await assert.rejects(
      callAgent("source", { path: "openapi.json", sourceRevision: "stale" }),
      /current source revision/,
    );
    await post("agent-access", { enabled: false });
    await post("intake/analyze", { environment: "test", preference: "api" });
    assert.equal(state.intake.mode, "repository");
    assert.equal(state.intake.candidates.length, 1);
    await post("intake/review", { reviewer: "Repo QE" });
    const inventory = fixtureInventory();
    inventory.cases[0]!.title = "Inventory availability";
    inventory.cases[0]!.steps = [
      { action: "GET inventory", expected: "available true" },
    ];
    await post("planning", { planning: inventory });
    assert.equal(state.intakeStatus.stale, true);
    await post("intake/generate", {}, 400);
    await post("intake/analyze", { environment: "test", preference: "api" });
    assert.equal(state.intake.mode, "combined");
    assert.equal(state.intake.candidates.length, 2);
    assert.equal(state.intakeStatus.blockers[0].kind, "mapping");
    await post("intake/map", {
      candidateId: state.intake.candidates[0].id,
      patch: {
        recipe: {
          kind: "api",
          requests: [
            {
              path: "/sample-app/api/inventory",
              method: "GET",
              assertions: [
                { path: "status", operator: "equals", expected: 200 },
                { path: "body.available", operator: "equals", expected: true },
              ],
            },
          ],
        },
      },
    });
    await post("intake/review", { reviewer: "Combined QE" });
    await post("intake/generate", {});
    assert.equal(state.project.tests.length, 2);
    assert.equal(state.project.catalog.length, 1);
    assert.ok(
      state.project.evidence.some(
        (e: { revision: string }) => e.revision === original,
      ),
    );
    await post("intake/trial", {}, 202);
    for (let n = 0; n < 200; n++) {
      await refresh();
      if (state.runs[0].state !== "running") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(state.runs[0].report.summary.passed, 2);
    assert.equal(state.runs[0].draftValidation, true);
    assert.ok(
      state.runs[0].report.results[0].observations.some(
        (o: { operation: string }) => o.operation === "api.request",
      ),
    );
    assert.equal(git("status", "--porcelain"), "");
    assert.equal(git("rev-parse", "HEAD"), original);
    const file = JSON.stringify({ ...contract, info: { version: "2" } });
    await writeFile(join(repo, "openapi.json"), file);
    git("add", ".");
    git("commit", "-m", "new source revision");
    await post("scan", {});
    assert.equal(state.intakeStatus.stale, true);
    await post("intake/trial", {}, 400);
    await app.close();
    app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
    await refresh();
    assert.equal(state.intake.mode, "combined");
    assert.equal(state.intake.review.reviewer, "Combined QE");
    assert.equal(state.intakeStatus.stale, true);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("SSO session prerequisites are reported before plan approval without launching an authentication browser", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-intake-sso-"));
  const app = await startWorkspace({
    port: 0,
    file: join(dir, "state.json"),
    authDirectory: join(dir, "auth"),
  });
  try {
    let state = await (await fetch(`${app.url}/api/workspace`)).json();
    const post = async (
      path: string,
      input: Record<string, unknown>,
      expected = 200,
    ) => {
      const response = await fetch(`${app.url}/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superq-token": state.token,
        },
        body: JSON.stringify({ revision: state.revision, ...input }),
      });
      const data = await response.json();
      assert.equal(response.status, expected, JSON.stringify(data));
      state = await (await fetch(`${app.url}/api/workspace`)).json();
    };
    const project = fixtureProject(app.url);
    project.roles = { buyer: { description: "Buyer" } };
    project.environments.test!.users = { buyer: { role: "buyer" } };
    project.environments.test!.defaultUser = "buyer";
    project.environments.test!.sso = {
      startPath: "/login",
      successPath: "/home",
      successText: "Signed in",
      allowedOrigins: [],
      maxAgeMinutes: 60,
    };
    await post("import", { project });
    await post("planning", { planning: fixtureInventory() });
    await post("intake/analyze", { environment: "test", preference: "web" });
    await post("intake/map", {
      candidateId: state.intake.candidates[0].id,
      patch: {
        recipe: {
          kind: "web",
          commands: [
            { type: "goto", path: "/home" },
            {
              type: "expectText",
              locator: { strategy: "text", value: "Ready" },
              value: "Ready",
            },
          ],
        },
      },
    });
    assert.equal(state.intakeStatus.blockers[0].kind, "authentication");
    await post("intake/review", { reviewer: "QE" }, 400);
    assert.equal(state.signIn, null);
    assert.equal(state.runs.length, 0);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("requirements-only intake automates an existing manual ID and executes that exact case", async () => {
  const { createQuickTest } = await import("../src/quick-test.js");
  const dir = await mkdtemp(join(tmpdir(), "superq-existing-manual-")),
    app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
  try {
    let state = await (await fetch(`${app.url}/api/workspace`)).json();
    const post = async (
      path: string,
      input: Record<string, unknown>,
      expected = 200,
    ) => {
      const r = await fetch(`${app.url}/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superq-token": state.token,
        },
        body: JSON.stringify({ revision: state.revision, ...input }),
      });
      const data = await r.json();
      assert.equal(r.status, expected, JSON.stringify(data));
      state = await (await fetch(`${app.url}/api/workspace`)).json();
    };
    const original = fixtureProject(`${app.url}/`);
    original.evidence = [
      {
        id: "EV",
        source: "Health contract",
        revision: "1",
        excerpt: "HTTP 200 and status ok",
      },
    ];
    original.requirements = [
      {
        id: "REQ",
        title: "API health",
        risk: "medium",
        criteria: [{ id: "AC", title: "Health status is ok" }],
        evidenceIds: ["EV"],
      },
    ];
    const p = createQuickTest(original, {
      kind: "api",
      id: "SQ-manual-health",
      title: "Existing manual health",
      requirementId: "REQ",
      criterionId: "AC",
      path: "/sample-app/api/health",
      responseField: "status",
      expected: "ok",
    });
    p.tests[0]!.steps = [];
    p.tests[0]!.data = { region: "east" };
    await post("import", { project: p });
    await post("intake/analyze", { environment: "test", preference: "api" });
    assert.equal(state.intake.mode, "requirements");
    assert.equal(state.intake.candidates[0].targetTestId, "SQ-manual-health");
    await post("intake/map", {
      candidateId: state.intake.candidates[0].id,
      patch: {
        recipe: {
          kind: "api",
          requests: [
            {
              path: "/sample-app/api/health",
              method: "GET",
              assertions: [
                { path: "status", operator: "equals", expected: 200 },
                { path: "body.status", operator: "equals", expected: "ok" },
              ],
            },
          ],
        },
      },
    });
    await post("intake/review", { reviewer: "QE" });
    await post("intake/generate", {});
    assert.deepEqual(state.intake.generated.testIds, ["SQ-manual-health"]);
    assert.equal(state.project.tests.length, 1);
    assert.equal(state.project.requirements.length, 1);
    assert.equal(state.project.catalog.length, 1);
    assert.deepEqual(state.project.tests[0].data, { region: "east" });
    await post("intake/trial", {}, 202);
    for (let n = 0; n < 200; n++) {
      state = await (await fetch(`${app.url}/api/workspace`)).json();
      if (state.runs[0].state !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(state.runs[0].report.results[0].id, "SQ-manual-health");
    assert.equal(state.runs[0].report.results[0].status, "passed");
    assert.equal(state.runs[0].draftValidation, true);
    assert.equal(state.project.tests[0].status, "draft");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
