import test from "node:test";
import assert from "node:assert/strict";
import { validateProject } from "../src/model.js";
import { sampleProject } from "../src/workspace/sample.js";
import { resolveAccount, run, Registry } from "../src/runner.js";
import { createServer } from "node:http";
import { createAdapters } from "../src/adapters.js";
function project() {
  const p = sampleProject(4310);
  p.roles = {
    admin: { description: "Administrator" },
    customer: { description: "Customer" },
  };
  p.environments = {
    qa: {
      baseURL: "http://qa.invalid/",
      data: { value: "qa", quantity: 2 },
      users: {
        admin: {
          role: "admin",
          username: "qa-admin",
          passwordEnv: "QA_PASS",
          tokenEnv: "QA_TOKEN",
        },
        buyer: { role: "customer", username: "qa-buyer" },
      },
      defaultUser: "admin",
      suiteData: { regression: { value: "qa-suite" } },
      testData: { "TC-105": { value: "qa-case", quantity: 4 } },
    },
    uat: {
      baseURL: "http://uat.invalid/",
      data: { value: "uat" },
      users: { buyer: { role: "customer", username: "uat-buyer" } },
    },
  };
  return validateProject(p);
}
test("accounts are environment-scoped; required roles, ambiguity, anonymous and missing secrets are explicit", () => {
  const p = project(),
    t = p.tests.find((t) => t.id === "TC-105")!;
  t.role = "admin";
  const account = resolveAccount(p, "qa", t, undefined, {
    QA_PASS: "private",
    QA_TOKEN: "token",
  });
  assert.equal(account?.username, "qa-admin");
  assert.equal(account?.password, "private");
  assert.throws(
    () => resolveAccount(p, "uat", t, undefined, {}),
    /required role/,
  );
  assert.throws(() => resolveAccount(p, "qa", t, "buyer", {}), /required role/);
  assert.throws(() => resolveAccount(p, "qa", t, undefined, {}), /QA_PASS/);
  assert.equal(
    resolveAccount(p, "qa", { ...t, role: undefined, anonymous: true }),
    undefined,
  );
  assert.equal(
    resolveAccount(p, "uat", { ...t, role: "customer" }, undefined, {})
      ?.username,
    "uat-buyer",
  );
  p.environments.uat!.users!.other = { role: "customer" };
  assert.throws(
    () => resolveAccount(p, "uat", { ...t, role: "customer" }, undefined, {}),
    /Select one/,
  );
  assert.throws(
    () => validateProject({ ...p, roles: {} }),
    /Unknown account role/,
  );
  assert.throws(
    () =>
      validateProject({
        ...p,
        environments: { qa: { ...p.environments.qa, defaultUser: "missing" } },
      }),
    /default user/,
  );
  assert.throws(() =>
    validateProject({
      ...p,
      environments: {
        qa: {
          ...p.environments.qa,
          users: { admin: { role: "admin", password: "plaintext" } },
        },
      },
    }),
  );
});
test("environment test overrides win, account metadata stays private, and absent users block before actions", async () => {
  const p = project();
  p.environments.qa!.users = {
    buyer: { role: "customer", username: "qa-buyer" },
  };
  p.environments.qa!.defaultUser = "buyer";
  p.execution.testIds = ["TC-105"];
  const t = p.tests.find((t) => t.id === "TC-105")!;
  t.role = "customer";
  p.data = { value: "global" };
  p.suites.regression!.data = { value: "suite" };
  t.data = { value: "case" };
  let seen = 0;
  const registry = new Registry().register("api:request", async (_i, ctx) => {
    seen++;
    if (ctx.baseURL === "http://qa.invalid/") {
      assert.equal(ctx.data.value, "qa-case");
      assert.equal(ctx.data.quantity, 4);
      assert.equal(ctx.data["user.username"], "qa-buyer");
    } else {
      assert.equal(ctx.baseURL, "http://uat.invalid/");
      assert.equal(ctx.data.value, "case");
      assert.equal(ctx.data.quantity, undefined);
      assert.equal(ctx.data["user.username"], "uat-buyer");
    }
    return { status: 200, body: { available: true } };
  });
  const results = await run(p, "qa", "regression", registry);
  assert.equal(results[0]!.status, "passed");
  assert.ok(!JSON.stringify(results).includes("qa-buyer"));
  assert.equal(
    (await run(p, "uat", "regression", registry))[0]!.status,
    "passed",
  );
  const blocked = await run(p, "uat", "regression", registry, {
    user: "not-there",
  });
  assert.equal(blocked[0]!.status, "blocked");
  assert.equal(seen, 2);
});
test("API adapters use environment API URLs, bearer secrets, named services and anonymous checks", async () => {
  const received: string[] = [];
  const server = createServer((req, res) => {
    received.push(req.headers.authorization ?? "anonymous");
    res.setHeader("content-type", "application/json");
    res.end('{"available":true}');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const p = project();
  p.environments.qa!.apiURL = `http://127.0.0.1:${address.port}/`;
  p.environments.qa!.users = {
    buyer: { role: "customer", tokenEnv: "SUPERQ_TEST_ACCOUNT_TOKEN" },
  };
  p.environments.qa!.defaultUser = "buyer";
  p.execution.testIds = ["TC-105"];
  const t = p.tests.find((t) => t.id === "TC-105")!;
  t.steps[0]!.assertions = [
    { path: "body.available", operator: "equals", expected: true },
  ];
  const prior = process.env.SUPERQ_TEST_ACCOUNT_TOKEN;
  process.env.SUPERQ_TEST_ACCOUNT_TOKEN = "private-fixture-token";
  const adapters = createAdapters();
  try {
    assert.equal(
      (await run(p, "qa", "regression", adapters.registry))[0]!.status,
      "passed",
    );
    t.anonymous = true;
    assert.equal(
      (await run(p, "qa", "regression", adapters.registry))[0]!.status,
      "passed",
    );
    assert.deepEqual(received, ["Bearer private-fixture-token", "anonymous"]);
    delete t.anonymous;
    p.environments.qa!.urls = { inventory: p.environments.qa!.apiURL! };
    t.steps[0]!.input.service = "inventory";
    assert.equal(
      (await run(p, "qa", "regression", adapters.registry))[0]!.status,
      "passed",
    );
    p.environments.qa!.apiURL = "http://different-api.invalid/";
    assert.equal(
      (await run(p, "qa", "regression", adapters.registry))[0]!.status,
      "passed",
    );
    assert.deepEqual(received.slice(-2), [
      "Bearer private-fixture-token",
      "anonymous",
    ]);
    p.environments.qa!.apiURL = `http://127.0.0.1:${address.port}/`;
    t.steps[0]!.input.headers = {
      Authorization: "Bearer deliberately-invalid",
    };
    assert.equal(
      (await run(p, "qa", "regression", adapters.registry))[0]!.status,
      "passed",
    );
    assert.equal(received.at(-1), "Bearer deliberately-invalid");
    assert.ok(!JSON.stringify(p).includes("private-fixture-token"));
  } finally {
    if (prior === undefined) delete process.env.SUPERQ_TEST_ACCOUNT_TOKEN;
    else process.env.SUPERQ_TEST_ACCOUNT_TOKEN = prior;
    await adapters.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("browser form login uses the selected environment account and reusable environment text", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url === "/login")
      res.end(
        "<label>Username<input id=\"u\"></label><label>Password<input id=\"p\" type=\"password\"></label><button onclick=\"if(document.querySelector('#u').value==='qa-admin'&&document.querySelector('#p').value==='private-login'){document.cookie='auth=yes; path=/';location.href='/home'}\">Sign in</button>",
      );
    else
      res.end(
        req.headers.cookie?.includes("auth=yes")
          ? "<h1>QA dashboard</h1>"
          : "<h1>Not signed in</h1>",
      );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const p = project();
  p.environments.qa!.baseURL = `http://127.0.0.1:${addr.port}/`;
  p.environments.qa!.users = {
    admin: {
      role: "admin",
      username: "qa-admin",
      passwordEnv: "SUPERQ_TEST_LOGIN_PASSWORD",
    },
  };
  p.environments.qa!.defaultUser = "admin";
  p.environments.qa!.login = {
    path: "login",
    usernameLabel: "Username",
    passwordLabel: "Password",
    submitButton: "Sign in",
    successPath: "home",
  };
  p.environments.qa!.data.heading = "QA dashboard";
  p.locators.dashboard = { strategy: "text", value: "${heading}" };
  const t = p.tests.find((t) => t.id === "TC-102")!;
  t.role = "admin";
  t.steps = [
    {
      action: "browser.journey",
      save: {},
      input: {
        commands: [
          { type: "goto", path: "home" },
          {
            type: "expectText",
            locator: "dashboard",
            value: "${heading}",
            timeoutMs: 500,
          },
        ],
      },
      assertions: [
        { path: "text.dashboard", operator: "equals", expected: "${heading}" },
      ],
    },
  ];
  p.execution.testIds = [t.id];
  const prior = process.env.SUPERQ_TEST_LOGIN_PASSWORD;
  process.env.SUPERQ_TEST_LOGIN_PASSWORD = "private-login";
  const adapters = createAdapters();
  try {
    const results = await run(p, "qa", "regression", adapters.registry);
    assert.equal(results[0]!.status, "passed");
    assert.ok(!JSON.stringify(results).includes("private-login"));
  } finally {
    if (prior === undefined) delete process.env.SUPERQ_TEST_LOGIN_PASSWORD;
    else process.env.SUPERQ_TEST_LOGIN_PASSWORD = prior;
    await adapters.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("account selection and environment configuration invalidate old run identity; reserved auth data cannot be spoofed", async () => {
  const { projectFingerprint } = await import("../src/identity.js");
  const p = project();
  const before = projectFingerprint(p);
  p.execution.user = "buyer";
  assert.notEqual(projectFingerprint(p), before);
  delete p.execution.user;
  p.environments.qa!.data.quantity = 7;
  assert.notEqual(projectFingerprint(p), before);
  assert.throws(
    () => validateProject({ ...p, data: { "user.token": "spoofed" } }),
    /reserved/,
  );
  assert.throws(
    () =>
      validateProject({
        ...p,
        environments: {
          qa: { ...p.environments.qa, urls: { api: "https://other.invalid/" } },
        },
      }),
    /reserved/,
  );
});
