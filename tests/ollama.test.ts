import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ollamaProvider } from "../src/ollama.js";
import { Planner } from "../src/ai.js";
import { validateProject } from "../src/model.js";
const proposal = {
  summary: "Verify contract",
  requirementId: "REQ-HEALTH",
  evidenceIds: ["DOC-1"],
  actionIds: ["health-request"],
  questions: [],
  steps: ["Check the documented health response"],
};
const digest = "a".repeat(64);
function transport(
  generate: typeof fetch,
  override: Record<string, unknown> = {},
  name = "fixture-local",
): typeof fetch {
  return async (url, options) => {
    const path = new URL(String(url)).pathname;
    assert.equal(options?.redirect, "error");
    if (Object.hasOwn(override, path)) return Response.json(override[path]);
    if (path === "/api/status")
      return Response.json({ cloud: { disabled: true } });
    if (path === "/api/tags")
      return Response.json({ models: [{ name, digest }] });
    if (path === "/api/show")
      return Response.json({
        details: { format: "gguf" },
        model_info: { "general.architecture": "llama" },
      });
    return generate(url, options);
  };
}
test("Ollama checks daemon and installed model before bounded structured generation, records identity and keeps output a draft", async () => {
  const p = validateProject(
    JSON.parse(await readFile("examples/project.json", "utf8")),
  );
  const provider = ollamaProvider(
    "fixture-local",
    undefined,
    transport(async (url, options) => {
      assert.equal(String(url), "http://127.0.0.1:11434/api/generate");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.stream, false);
      assert.equal(body.options.num_predict, 2000);
      assert.equal(body.format.type, "object");
      return Response.json({
        done: true,
        done_reason: "stop",
        response: JSON.stringify(proposal),
      });
    }),
  );
  const plan = await new Planner(provider, 0.01).propose(p, "REQ-HEALTH", 0.01);
  assert.equal(plan.requirementId, "REQ-HEALTH");
  assert.equal(p.tests.length, 3);
  assert.deepEqual(provider.identity, {
    name: "fixture-local",
    digest,
    cloudDisabled: true,
  });
});
test("Ollama rejects remote endpoints, cloud model names, incomplete or unsupported responses", async () => {
  assert.throws(
    () => ollamaProvider("fixture", "https://example.com"),
    /loopback/,
  );
  assert.throws(() => ollamaProvider("some-model:cloud"), /local model/);
  const incomplete = ollamaProvider(
    "fixture-local",
    undefined,
    transport(async () =>
      Response.json({ done: true, done_reason: "length", response: "{}" }),
    ),
  );
  await assert.rejects(
    () => incomplete({ prompt: "test", maxOutputTokens: 10 }),
    /truncated/,
  );
  const p = validateProject(
    JSON.parse(await readFile("examples/project.json", "utf8")),
  );
  const fake = ollamaProvider(
    "fixture-local",
    undefined,
    transport(async () =>
      Response.json({
        done: true,
        response: JSON.stringify({ ...proposal, evidenceIds: ["invented"] }),
      }),
    ),
  );
  await assert.rejects(
    () => new Planner(fake, 0.01).propose(p, "REQ-HEALTH", 0.01),
    /Unsupported AI/,
  );
});
test("cloud-enabled, unknown, remote alias and missing models receive no source prompt or inference call", async () => {
  for (const override of [
    { "/api/status": { cloud: { disabled: false } } },
    { "/api/status": {} },
    { "/api/tags": { models: [] } },
    {
      "/api/tags": {
        models: [
          {
            name: "fixture-local",
            digest,
            remote_host: "https://ollama.com",
            remote_model: "private-model",
          },
        ],
      },
    },
    {
      "/api/show": {
        details: { format: "gguf" },
        model_info: { x: 1 },
        remote_model: "remote",
      },
    },
    { "/api/show": { details: { format: "gguf" }, model_info: {} } },
  ]) {
    const sent: string[] = [];
    const base = transport(async () => {
      throw new Error("Must not generate");
    }, override);
    const provider = ollamaProvider(
      "fixture-local",
      undefined,
      async (url, options) => {
        sent.push(String(options?.body));
        return base(url, options);
      },
    );
    await assert.rejects(() =>
      provider({ prompt: "PRIVATE-SOURCE", maxOutputTokens: 10 }),
    );
    assert.ok(!sent.some((v) => v.includes("PRIVATE-SOURCE")));
    assert.equal(provider.identity, undefined);
  }
});
test("model replacement during generation discards the result", async () => {
  let tags = 0;
  const base = transport(async () =>
    Response.json({ done: true, response: JSON.stringify(proposal) }),
  );
  const provider = ollamaProvider(
    "fixture-local",
    undefined,
    async (url, options) => {
      if (new URL(String(url)).pathname === "/api/tags" && ++tags > 1)
        return Response.json({
          models: [{ name: "fixture-local", digest: "b".repeat(64) }],
        });
      return base(url, options);
    },
  );
  await assert.rejects(
    () => provider({ prompt: "test", maxOutputTokens: 10 }),
    /changed during/,
  );
});
