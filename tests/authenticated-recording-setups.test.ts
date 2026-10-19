import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, type Browser } from "@playwright/test";
import { startRecording } from "../src/recorder.js";
import { recordingContext } from "../src/web-auth.js";
import { beginSignIn, totp, revokeSession } from "../src/auth-session.js";
import { fixtureProject, fixtureInventory } from "./intake-fixtures.js";
import { Recipe, discover, materialize, preflight } from "../src/intake.js";
import { extractSetup } from "../src/web-setups.js";
import { validateProject } from "../src/model.js";
import { createAdapters } from "../src/adapters.js";
import { run } from "../src/runner.js";
import { reviewFingerprint, isReviewCurrent } from "../src/identity.js";
import { catalogHealth } from "../src/catalog.js";
import { startWorkspace } from "../src/workspace-server.js";

async function serve(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
const html =
  '<label>Customer<input data-testid="customer"></label><button onclick="document.querySelector(\'p\').textContent=document.querySelector(\'input\').value">Confirm</button><p data-testid="status">Ready</p>';
const flow = () =>
  Recipe.parse({
    kind: "web",
    commands: [
      { type: "goto", path: "/" },
      {
        type: "fill",
        locator: { strategy: "testId", value: "customer" },
        value: "${customer}",
      },
      {
        type: "click",
        locator: { strategy: "role", value: "button", name: "Confirm" },
      },
      {
        type: "expectText",
        locator: { strategy: "testId", value: "status" },
        value: "${customer}",
        timeoutMs: 200,
      },
    ],
  });

test("shared setup runs in each isolated case with that cases data, own oracle, review identity and structured setup observations", async () => {
  const app = await serve((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(html);
  });
  const p = fixtureProject(app.url),
    plan = discover(p, "test", "web", fixtureInventory());
  try {
    plan.candidates[0]!.recipe = Recipe.parse(
      extractSetup(p, flow(), "prepare", "Prepare customer", 3),
    );
    plan.context.project = (
      await import("../src/identity.js")
    ).projectFingerprint(p);
    assert.ok(
      preflight(p, plan).some(
        (b) => b.kind === "data" && b.detail.includes("customer"),
      ),
    );
    p.environments.test!.data.customer = "Synthetic";
    const project = materialize(p, plan),
      first = project.tests[0]!;
    first.status = "approved";
    first.data.customer = "First";
    first.review = {
      reviewer: "QE",
      at: new Date().toISOString(),
      digest: reviewFingerprint(project, first),
    };
    const second = structuredClone(first);
    second.id = "case-2";
    second.data.customer = "Second";
    second.review = {
      reviewer: "QE",
      at: new Date().toISOString(),
      digest: reviewFingerprint(project, second),
    };
    project.tests.push(second);
    project.execution.workers = 2;
    const adapters = createAdapters();
    try {
      const results = await run(project, "test", "intake", adapters.registry);
      assert.deepEqual(
        results.map((r) => r.status),
        ["passed", "passed"],
      );
      assert.ok(
        results.every(
          (r) =>
            r.observations?.filter((o) => o.setupId === "prepare").length === 3,
        ),
      );
      assert.ok(
        results.every((r) =>
          r.observations?.some(
            (o) =>
              o.operation === "web.expectText" && o.command === 1 && !o.setupId,
          ),
        ),
      );
      second.steps[0]!.assertions[0]!.expected = "Wrong";
      assert.equal(
        (await run(project, "test", "intake", adapters.registry))[1]!.status,
        "failed",
      );
    } finally {
      await adapters.close();
    }
    assert.ok(isReviewCurrent(project, first));
    project.webSetups!.prepare!.title = "Reviewed setup changed";
    assert.ok(!isReviewCurrent(project, first));
    const used = Object.values(project.webSetups!.prepare!.commands).flatMap(
      (c) => ("locator" in c ? [c.locator] : []),
    );
    assert.ok(
      used.every((id) => !catalogHealth(project).unusedLocators.includes(id)),
    );
    assert.ok(
      catalogHealth(project)
        .locators.find((l) => l.id === used[0])!
        .testIds.includes(first.id),
    );
    const broken = structuredClone(project);
    broken.tests[0]!.steps[0]!.input.setupIds = ["missing"];
    assert.throws(() => validateProject(broken), /Unknown web setup/);
    assert.throws(
      () => extractSetup(p, flow(), "duplicate", "Duplicate", 3),
      /already exists/,
    );
    assert.throws(
      () => extractSetup(p, flow(), "bad", "Bad", 4),
      /keeping assertions/,
    );
  } finally {
    await app.close();
  }
});

test("form/MFA recorder authenticates before installing capture and never records sign-in or secret values", async () => {
  const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    password = "fixture-private-password";
  let verified = 0;
  const app = await serve(async (req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url === "/login")
      return res.end(
        '<form method="POST" action="/auth"><label>Username<input name="username"></label><label>Password<input type="password" name="password"></label><button>Sign in</button></form>',
      );
    if (req.url === "/auth") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const values = new URLSearchParams(body);
      if (values.get("password") !== password) {
        res.statusCode = 401;
        return res.end("Denied");
      }
      res.setHeader("set-cookie", "challenge=ok; Path=/");
      return res.end(
        '<form method="POST" action="/verify"><label>Code<input name="code"></label><button>Verify</button></form>',
      );
    }
    if (req.url === "/verify") {
      let body = "";
      for await (const chunk of req) body += chunk;
      if (
        !req.headers.cookie?.includes("challenge=ok") ||
        new URLSearchParams(body).get("code") !== totp(seed)
      ) {
        res.statusCode = 401;
        return res.end("Denied");
      }
      verified++;
      res.writeHead(302, {
        "set-cookie": "session=fixture-private-cookie; Path=/; HttpOnly",
        location: "/home",
      });
      return res.end();
    }
    res.end(
      req.headers.cookie?.includes("session=fixture-private-cookie")
        ? `<h1>Welcome qa-user</h1>${html}`
        : "Sign in required",
    );
  });
  const oldPass = process.env.SUPERQ_RECORD_PASSWORD,
    oldSeed = process.env.SUPERQ_RECORD_TOTP;
  process.env.SUPERQ_RECORD_PASSWORD = password;
  process.env.SUPERQ_RECORD_TOTP = seed;
  let browser: Browser | undefined;
  let recording: Awaited<ReturnType<typeof startRecording>> | undefined;
  try {
    const p = fixtureProject(app.url);
    p.roles = {
      buyer: { description: "Buyer" },
      admin: { description: "Admin" },
    };
    p.environments.test!.users = {
      buyer: {
        role: "buyer",
        username: "qa-user",
        passwordEnv: "SUPERQ_RECORD_PASSWORD",
        totpSecretEnv: "SUPERQ_RECORD_TOTP",
      },
    };
    p.environments.test!.login = {
      path: "/login",
      usernameLabel: "Username",
      passwordLabel: "Password",
      submitButton: "Sign in",
      successPath: "/home",
      mfa: {
        codeLabel: "Code",
        submitButton: "Verify",
        digits: 6,
        period: 30,
        algorithm: "sha1",
      },
    };
    assert.throws(
      () => recordingContext(p, "test", { role: "admin", user: "buyer" }),
      /required role/,
    );
    const context = recordingContext(p, "test", { role: "buyer" });
    recording = await startRecording(
      app.url,
      "/home",
      async (proxy) => (browser = await chromium.launch({ proxy })),
      { context },
    );
    assert.equal(verified, 1);
    assert.deepEqual(recording.snapshot().commands, [
      { type: "goto", path: "/home" },
    ]);
    const page = browser!.contexts()[0]!.pages()[0]!;
    await page.getByLabel("Customer").fill("private-customer");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => recording!.snapshot().commands.length).toBe(3);
    const snapshot = JSON.stringify(recording.snapshot());
    for (const secret of [
      password,
      seed,
      "fixture-private-cookie",
      "private-customer",
      "Sign in",
      "Username",
      "Verify",
    ])
      assert.ok(!snapshot.includes(secret));
  } finally {
    await recording?.close();
    await app.close();
    if (oldPass === undefined) delete process.env.SUPERQ_RECORD_PASSWORD;
    else process.env.SUPERQ_RECORD_PASSWORD = oldPass;
    if (oldSeed === undefined) delete process.env.SUPERQ_RECORD_TOTP;
    else process.env.SUPERQ_RECORD_TOTP = oldSeed;
  }
});

test("SSO recording restores only a current scoped session and rejects missing or revoked sessions before browser launch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-record-sso-"));
  let accepted = true;
  const app = await serve((req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url === "/login") {
      res.writeHead(302, {
        "set-cookie": "session=fixture-sso-cookie; Path=/; HttpOnly",
        location: "/home",
      });
      return res.end();
    }
    res.end(
      accepted && req.headers.cookie?.includes("session=fixture-sso-cookie")
        ? `<h1>Welcome qa-user</h1>${html}`
        : "Sign in required",
    );
  });
  const p = fixtureProject(app.url);
  p.roles = { buyer: { description: "Buyer" } };
  p.environments.test!.users = {
    buyer: {
      role: "buyer",
      username: "qa-user",
      passwordEnv: "UNAVAILABLE_FOR_SSO",
    },
  };
  p.environments.test!.sso = {
    startPath: "/login",
    successPath: "/home",
    successText: "Welcome qa-user",
    allowedOrigins: [],
    maxAgeMinutes: 10,
  };
  let launches = 0,
    recording: Awaited<ReturnType<typeof startRecording>> | undefined;
  const connector = async (proxy: { server: string; bypass: string }) => {
    launches++;
    return chromium.launch({ proxy });
  };
  try {
    const context = recordingContext(p, "test", { user: "buyer" });
    await assert.rejects(
      startRecording(app.url, "/home", connector, { context, directory: dir }),
      /Sign in again/,
    );
    assert.equal(launches, 0);
    const signIn = await beginSignIn(
      p,
      "test",
      "buyer",
      dir,
      async (_p, _n, { proxy }) => chromium.launch({ proxy }),
    );
    try {
      await signIn.finish();
    } finally {
      await signIn.cancel();
    }
    recording = await startRecording(app.url, "/home", connector, {
      context,
      directory: dir,
    });
    assert.deepEqual(recording.snapshot().commands, [
      { type: "goto", path: "/home" },
    ]);
    assert.ok(
      !JSON.stringify(recording.snapshot()).includes("fixture-sso-cookie"),
    );
    await recording.close();
    accepted = false;
    await assert.rejects(
      startRecording(app.url, "/home", connector, { context, directory: dir }),
      /account\/session/,
    );
    await revokeSession(p, "test", "buyer", dir);
    await assert.rejects(
      startRecording(app.url, "/home", connector, { context, directory: dir }),
      /Sign in again/,
    );
    assert.equal(launches, 2);
  } finally {
    await recording?.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Studio selects an account, records after login, extracts a shared setup and trials the same case with its original oracle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-setups-studio-"));
  let browser: Browser | undefined, captureBrowser: Browser | undefined;
  const target = await serve(async (req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url === "/login")
      return res.end(
        '<form action="/session" method="POST"><label>Username<input name="username"></label><label>Password<input name="password" type="password"></label><button>Sign in</button></form>',
      );
    if (req.url === "/session") {
      let body = "";
      for await (const c of req) body += c;
      if (new URLSearchParams(body).get("password") !== "fixture-pass") {
        res.statusCode = 401;
        return res.end("Denied");
      }
      res.writeHead(302, {
        "set-cookie": "session=studio-fixture; Path=/; HttpOnly",
        location: "/home",
      });
      return res.end();
    }
    res.end(
      req.headers.cookie?.includes("session=studio-fixture")
        ? html
        : "Sign in required",
    );
  });
  const old = process.env.SUPERQ_STUDIO_RECORD_PASS;
  process.env.SUPERQ_STUDIO_RECORD_PASS = "fixture-pass";
  const app = await startWorkspace({
    port: 0,
    file: join(dir, "state.json"),
    recorderConnector: async (proxy) =>
      (captureBrowser = await chromium.launch({ proxy })),
  });
  const get = async () =>
    await (await fetch(`${app.url}/api/workspace`)).json();
  const post = async (
    path: string,
    body: Record<string, unknown>,
    expected = 200,
  ) => {
    const s = await get(),
      r = await fetch(`${app.url}/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superq-token": s.token,
        },
        body: JSON.stringify({ ...body, revision: s.revision }),
      });
    const output = await r.json();
    assert.equal(r.status, expected, JSON.stringify(output));
    return output;
  };
  try {
    const p = fixtureProject(target.url);
    p.roles = { buyer: { description: "Buyer" } };
    p.environments.test!.users = {
      buyer: {
        role: "buyer",
        username: "qa-user",
        passwordEnv: "SUPERQ_STUDIO_RECORD_PASS",
      },
    };
    p.environments.test!.login = {
      path: "/login",
      usernameLabel: "Username",
      passwordLabel: "Password",
      submitButton: "Sign in",
      successPath: "/home",
    };
    p.environments.test!.data["recorded.field1"] = "Synthetic";
    await post("import", { project: p });
    await post("planning", { planning: fixtureInventory() });
    await post("intake/analyze", { environment: "test", preference: "web" });
    browser = await chromium.launch();
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      }),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(10000);
    await page.goto(`${app.url}/#intake`);
    await page.getByText("Record a web flow", { exact: true }).click();
    await page
      .getByLabel("Recording account", { exact: true })
      .selectOption("buyer");
    await page.getByLabel("Starting application path").fill("/home");
    const request = page.waitForRequest((r) =>
      r.url().endsWith("/api/recorder/start"),
    );
    await page.getByRole("button", { name: "Open recording browser" }).click();
    assert.equal((await request).postDataJSON().user, "buyer");
    await expect
      .poll(() => captureBrowser?.contexts()[0]?.pages()[0]?.url())
      .toBe(`${target.url}/home`);
    const capture = captureBrowser!.contexts()[0]!.pages()[0]!;
    await capture.getByLabel("Customer").fill("PRIVATE-ENTERED-VALUE");
    await capture.getByRole("button", { name: "Confirm" }).click();
    await expect
      .poll(async () => (await get()).recording?.commands.length)
      .toBe(3);
    await page
      .getByLabel("Expected result locator", { exact: true })
      .fill("status");
    await page
      .getByLabel("Expected text", { exact: true })
      .fill("${recorded.field1}");
    await page
      .getByRole("button", { name: "Add expected result", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save recording as draft" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Save recording as draft" }).click();
    await expect.poll(async () => !(await get()).recording).toBe(true);
    let s = await get();
    assert.equal(s.intake.candidates[0].user, "buyer");
    assert.equal(s.intake.candidates[0].role, "buyer");
    assert.equal(s.intake.candidates[0].anonymous, false);
    await page
      .getByText("Reusable browser setup flows", { exact: true })
      .click();
    await page
      .getByLabel("New setup ID", { exact: true })
      .fill("prepare-customer");
    await page
      .getByLabel("Setup title", { exact: true })
      .fill("Prepare customer");
    await page.getByLabel("First commands to share", { exact: true }).fill("3");
    await page
      .getByRole("button", {
        name: "Extract setup and reference it in this case",
      })
      .click();
    await expect
      .poll(async () => !!(await get()).project.webSetups?.["prepare-customer"])
      .toBe(true);
    s = await get();
    assert.deepEqual(s.intake.candidates[0].recipe.setupIds, [
      "prepare-customer",
    ]);
    assert.equal(s.intake.candidates[0].recipe.commands.length, 1);
    assert.equal(
      s.intake.candidates[0].recipe.commands[0].value,
      "${recorded.field1}",
    );
    assert.equal(s.intake.review, undefined);
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
        path: "/tmp/superq-auth-setup-mobile.png",
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await post("intake/review", { reviewer: "QE" });
    await post("intake/generate", {});
    await post("intake/trial", {}, 202);
    await expect
      .poll(async () => (await get()).runs[0].state)
      .toBe("completed");
    s = await get();
    assert.equal(s.runs[0].report.summary.passed, 1);
    assert.equal(
      s.runs[0].report.results[0].observations.filter(
        (o: { setupId?: string }) => o.setupId === "prepare-customer",
      ).length,
      3,
    );
    await page.goto(`${app.url}/#quality`);
    await page
      .getByRole("button", { name: "Catalog reuse", exact: true })
      .click();
    await page
      .getByText("Prepare customer (prepare-customer) · 1 referencing tests", {
        exact: true,
      })
      .click();
    await page
      .getByLabel("Shared setup title", { exact: true })
      .fill("Prepare customer updated");
    await page
      .getByRole("button", {
        name: "Save setup and mark affected tests for review",
      })
      .click();
    await expect
      .poll(
        async () => (await get()).project.webSetups["prepare-customer"].title,
      )
      .toBe("Prepare customer updated");
    s = await get();
    assert.equal(s.project.tests[0].status, "draft");
    assert.equal(s.project.tests[0].review, undefined);
    assert.equal(s.intake.review, undefined);
    const saved = await readFile(join(dir, "state.json"), "utf8");
    for (const value of [
      "PRIVATE-ENTERED-VALUE",
      "fixture-pass",
      "studio-fixture",
    ])
      assert.ok(!saved.includes(value));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await app.close();
    await target.close();
    await rm(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.SUPERQ_STUDIO_RECORD_PASS;
    else process.env.SUPERQ_STUDIO_RECORD_PASS = old;
  }
});
