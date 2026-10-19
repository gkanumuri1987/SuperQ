import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startWorkspace } from "../src/workspace-server.js";
import { workspaceAgentCall } from "../src/mcp-server.js";
import {
  fixtureProject,
  fixtureInventory,
  webRecipe,
} from "./intake-fixtures.js";

test("real MCP stdio client proposes evidence-backed automation but cannot approve, bypass review or run without a separate grant", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-mcp-"));
  const app = await startWorkspace({ port: 0, file: join(dir, "state.json") });
  const client = new Client({
    name: "Corporate agent fixture",
    version: "1.0",
  });
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
      const data = await response.json();
      assert.equal(response.status, expected, JSON.stringify(data));
      await refresh();
      return data;
    };
    const project = fixtureProject(`${app.url}/sample-app/`);
    project.data.privateData = "NOT_SHARED_DATA";
    project.environments.test!.data.privateEnvData = "NOT_SHARED_ENV";
    await post("import", { project });
    const inventory = fixtureInventory();
    inventory.cases[0]!.title = "Place an order";
    inventory.cases[0]!.steps = [
      {
        action: "Open /sample-app and click Place order",
        expected: "Order confirmed",
      },
    ];
    await post("planning", { planning: inventory });
    assert.equal(
      (
        await fetch(`${app.url}/api/agent`, {
          method: "POST",
          body: '{"action":"context"}',
        })
      ).status,
      403,
    );
    await post("agent-access", { enabled: true, allowTrials: false });
    const connectionFile = state.agentConnection.file;
    assert.ok(connectionFile);
    const connection = JSON.parse(await readFile(connectionFile, "utf8"));
    assert.notEqual(connection.token, state.token);
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", resolve("src/mcp-server.ts")],
        env: { SUPERQ_AGENT_CONNECTION: connectionFile },
        stderr: "pipe",
      }),
    );
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name).sort(), [
      "superq_analyze",
      "superq_context",
      "superq_propose_automation",
      "superq_propose_case",
      "superq_source",
      "superq_trial",
    ]);
    assert.equal(
      tools.tools.find((t) => t.name === "superq_context")!.annotations!
        .readOnlyHint,
      true,
    );
    const context = await client.callTool({
      name: "superq_context",
      arguments: {},
    });
    const text = JSON.stringify(context);
    assert.ok(!text.includes(state.token));
    assert.ok(!text.includes(connection.token));
    assert.ok(!text.includes("NOT_SHARED_DATA"));
    assert.ok(!text.includes("NOT_SHARED_ENV"));
    assert.equal(
      (
        await client.callTool({
          name: "superq_analyze",
          arguments: {
            revision: state.revision,
            environment: "test",
            preference: "web",
          },
        })
      ).isError,
      undefined,
    );
    await refresh();
    const candidateId = state.intake.candidates[0].id;
    assert.equal(
      (await post("intake/review", { reviewer: "QE" }, 400)).error,
      "Resolve all selected plan blockers before review",
    );
    const recipe = webRecipe();
    if (recipe.kind === "web")
      recipe.commands = [
        { type: "goto", path: "/sample-app" },
        {
          type: "expectText",
          locator: { strategy: "testId", value: "order-status" },
          value: "Ready to place your order",
        },
        {
          type: "click",
          locator: { strategy: "role", value: "button", name: "Place order" },
        },
        {
          type: "expectText",
          locator: { strategy: "testId", value: "order-status" },
          value: "Order confirmed",
        },
      ];
    const mapped = await client.callTool({
      name: "superq_propose_automation",
      arguments: {
        revision: state.revision,
        candidateId,
        patch: { recipe, anonymous: true },
      },
    });
    assert.equal(mapped.isError, undefined);
    await refresh();
    const beforeReview = await client.callTool({
      name: "superq_trial",
      arguments: { revision: state.revision },
    });
    assert.equal(beforeReview.isError, true);
    // The agent credential cannot authenticate to human review endpoints.
    const forbidden = await fetch(`${app.url}/api/intake/review`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-superq-token": connection.token,
      },
      body: JSON.stringify({ revision: state.revision, reviewer: "Agent" }),
    });
    assert.equal(forbidden.status, 403);
    assert.equal(
      String(
        await workspaceAgentCall(connectionFile)("approve", {
          revision: state.revision,
        }).catch((e) => e.message),
      ).includes("Approval"),
      true,
    );
    const stale = await client.callTool({
      name: "superq_propose_automation",
      arguments: {
        revision: state.revision - 1,
        candidateId,
        patch: { selected: true },
      },
    });
    assert.equal(stale.isError, true);
    await post("intake/review", { reviewer: "Fixture QE" });
    await post("intake/generate", {});
    assert.equal(state.project.tests[0].status, "draft");
    assert.equal(
      (
        await client.callTool({
          name: "superq_trial",
          arguments: { revision: state.revision },
        })
      ).isError,
      true,
    );
    await post("agent-access", { enabled: true, allowTrials: true });
    const trial = await client.callTool({
      name: "superq_trial",
      arguments: { revision: state.revision },
    });
    assert.equal(trial.isError, undefined);
    for (let n = 0; n < 300; n++) {
      await refresh();
      if (state.runs[0].state !== "running") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(state.runs[0].state, "completed");
    assert.equal(state.runs[0].report.results[0].status, "passed");
    assert.equal(state.runs[0].draftValidation, true);
    assert.equal(state.project.tests[0].status, "draft");
    assert.deepEqual(
      state.runs[0].report.results[0].observations.map(
        (o: { operation: string }) => o.operation,
      ),
      [
        "web.goto",
        "web.expectText",
        "web.click",
        "web.expectText",
        "assert",
        "assert",
      ],
    );
    await post("approve", { testId: candidateId, reviewer: "QE after trial" });
    // A separately reviewed test runs normally after completing the plan workflow.
    await post(
      "runs",
      {
        environment: "test",
        suite: "intake",
        profile: "local",
        workers: 1,
        testIds: [candidateId],
      },
      202,
    );
    for (let n = 0; n < 300; n++) {
      await refresh();
      if (state.runs[0].state !== "running") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(state.runs[0].report.results[0].status, "passed");
    await post("agent-access", { enabled: false });
    assert.equal(
      (await client.callTool({ name: "superq_context", arguments: {} }))
        .isError,
      true,
    );
    assert.equal(
      (
        await fetch(`${app.url}/api/agent`, {
          method: "POST",
          headers: { "x-superq-agent": connection.token },
          body: '{"action":"context"}',
        })
      ).status,
      403,
    );
  } finally {
    await client.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent connection rejects public files and non-loopback destinations", async () => {
  const { writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "superq-agent-file-")),
    file = join(dir, "connection.json");
  try {
    assert.throws(() => workspaceAgentCall("relative.json"), /absolute/);
    await writeFile(
      file,
      JSON.stringify({
        url: "https://example.invalid/",
        token: "a".repeat(64),
      }),
      { mode: 0o600 },
    );
    await assert.rejects(workspaceAgentCall(file)("context"), /local SuperQ/);
    if (process.platform !== "win32") {
      await chmod(file, 0o644);
      await assert.rejects(
        workspaceAgentCall(file)("context"),
        /private regular/,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
