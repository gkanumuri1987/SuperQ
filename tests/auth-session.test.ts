import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, type Browser } from "@playwright/test";
import {
  beginSignIn,
  loadSession,
  revokeSession,
  totp,
  authIdentity,
} from "../src/auth-session.js";
import { sampleProject } from "../src/workspace/sample.js";
import { createAdapters } from "../src/adapters.js";
import { run } from "../src/runner.js";

test("TOTP matches RFC 6238 vectors and rejects invalid test-account seeds", () => {
  const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  for (const [seconds, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const)
    assert.equal(totp(seed, { digits: 8, time: seconds * 1000 }), expected);
  const base32 = (value: string) => {
    const bits = [...Buffer.from(value)]
      .map((b) => b.toString(2).padStart(8, "0"))
      .join("");
    return (bits.match(/.{1,5}/g) ?? [])
      .map(
        (chunk) =>
          "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[parseInt(chunk.padEnd(5, "0"), 2)],
      )
      .join("");
  };
  assert.equal(
    totp(base32("12345678901234567890123456789012"), {
      digits: 8,
      time: 59000,
      algorithm: "sha256",
    }),
    "46119246",
  );
  assert.equal(
    totp(
      base32(
        "1234567890123456789012345678901234567890123456789012345678901234",
      ),
      { digits: 8, time: 59000, algorithm: "sha512" },
    ),
    "90693936",
  );
  assert.throws(() => totp("not a valid seed!"), /Invalid TOTP/);
});

test("interactive SSO/MFA capture restores isolated sessions, drops IdP-only state, enforces scope/expiry and blocks stale authentication", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superq-auth-"));
  let appURL = "";
  let accepted = true;
  let idpRequests = 0;
  const idp = createServer((req, res) => {
    idpRequests++;
    res.setHeader("content-type", "text/html");
    if (req.url?.startsWith("/verify?code=246810")) {
      res.writeHead(302, {
        "set-cookie": "idp-only=private-idp-cookie; Path=/",
        location: `${appURL}/callback`,
      });
      res.end();
    } else
      res.end(
        '<form action="/verify"><label>MFA code<input name="code"></label><button>Continue</button></form>',
      );
  });
  await new Promise<void>((r) => idp.listen(0, "127.0.0.1", r));
  const idpAddr = idp.address();
  assert.ok(idpAddr && typeof idpAddr !== "string");
  const idpURL = `http://localhost:${idpAddr.port}`;
  const app = createServer((req, res) => {
    if (req.url === "/login") {
      res.writeHead(302, { location: `${idpURL}/authorize` });
      res.end();
    } else if (req.url === "/callback") {
      res.writeHead(302, {
        "set-cookie": "app-auth=private-app-cookie; Path=/; HttpOnly",
        location: "/home",
      });
      res.end();
    } else {
      res.setHeader("content-type", "text/html");
      res.end(
        accepted && req.headers.cookie?.includes("app-auth=private-app-cookie")
          ? '<h1>Welcome qa-user</h1><script>localStorage.setItem("app-proof","saved")</script>'
          : "<h1>Sign in required</h1>",
      );
    }
  });
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  const addr = app.address();
  assert.ok(addr && typeof addr !== "string");
  appURL = `http://127.0.0.1:${addr.port}`;
  const p = sampleProject(4310);
  p.roles = { customer: { description: "Customer" } };
  p.environments = {
    qa: {
      baseURL: appURL,
      data: {},
      users: {
        buyer: {
          role: "customer",
          username: "qa-user",
          passwordEnv: "MUST_NOT_REQUIRE_PASSWORD_FOR_SESSION_REUSE",
        },
      },
      defaultUser: "buyer",
      sso: {
        startPath: "/login",
        successPath: "/home",
        successText: "Welcome ${user.username}",
        allowedOrigins: [idpURL],
        maxAgeMinutes: 5,
      },
    },
  };
  p.execution.testIds = ["TC-102"];
  p.locators.welcome = { strategy: "text", value: "Welcome qa-user" };
  const t = p.tests.find((t) => t.id === "TC-102")!;
  t.role = "customer";
  t.steps = [
    {
      action: "browser.journey",
      save: {},
      input: {
        commands: [
          { type: "goto", path: "/home" },
          { type: "expectText", locator: "welcome", value: "Welcome qa-user" },
        ],
      },
      assertions: [
        {
          path: "text.welcome",
          operator: "equals",
          expected: "Welcome qa-user",
        },
      ],
    },
  ];
  let capturedBrowser: Browser | undefined;
  const capture = await beginSignIn(
    p,
    "qa",
    "buyer",
    dir,
    async (_profile, _name, options) => {
      capturedBrowser = await chromium.launch({ proxy: options.proxy });
      return capturedBrowser;
    },
  );
  try {
    const page = capturedBrowser!.contexts()[0]!.pages()[0]!;
    await page.getByLabel("MFA code").fill("246810");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(`${appURL}/home`);
    await capture.finish();
    assert.equal(capture.isClosed(), true);
    const state = await loadSession(p, "qa", "buyer", dir);
    assert.ok(state.cookies.some((c) => c.name === "app-auth"));
    assert.ok(!state.cookies.some((c) => c.name === "idp-only"));
    assert.deepEqual(
      state.origins.map((o) => o.origin),
      [appURL],
    );
    const file = join(dir, `${authIdentity(p, "qa", "buyer").key}.json`);
    if (process.platform !== "win32")
      assert.equal((await stat(file)).mode & 0o077, 0);
    const adapters = createAdapters(undefined, undefined, dir);
    try {
      assert.equal(
        (await run(p, "qa", "regression", adapters.registry))[0]!.status,
        "passed",
      );
      assert.equal(
        (await run(p, "qa", "regression", adapters.registry))[0]!.status,
        "passed",
      );
      accepted = false;
      const stale = await run(p, "qa", "regression", adapters.registry);
      assert.equal(stale[0]!.status, "blocked");
      assert.ok(!JSON.stringify(stale).includes("private-app-cookie"));
    } finally {
      await adapters.close();
    }
    const clone = structuredClone(p);
    clone.environments.uat = clone.environments.qa!;
    await assert.rejects(() => loadSession(clone, "uat", "buyer", dir));
    clone.environments.qa!.users!.other = {
      role: "customer",
      username: "qa-user",
    };
    await assert.rejects(() => loadSession(clone, "qa", "other", dir));
    const payload = JSON.parse(await readFile(file, "utf8"));
    payload.expiresAt = new Date(Date.now() - 1000).toISOString();
    await writeFile(file, JSON.stringify(payload));
    await assert.rejects(() => loadSession(p, "qa", "buyer", dir));
    let launched = false;
    const guarded = createAdapters(
      undefined,
      async () => {
        launched = true;
        throw new Error("Must not launch");
      },
      dir,
    );
    try {
      assert.equal(
        (await run(p, "qa", "regression", guarded.registry))[0]!.status,
        "blocked",
      );
      assert.equal(launched, false);
    } finally {
      await guarded.close();
    }
    await revokeSession(p, "qa", "buyer", dir);
    assert.equal((await readdir(dir)).length, 0);
    const restricted = structuredClone(p);
    restricted.environments.qa!.sso!.allowedOrigins = [];
    const beforeDenied = idpRequests;
    let deniedBrowser: Browser | undefined;
    let deniedHandle: Awaited<ReturnType<typeof beginSignIn>> | undefined;
    try {
      await assert.rejects(
        async () =>
          (deniedHandle = await beginSignIn(
            restricted,
            "qa",
            "buyer",
            dir,
            async (_profile, _name, options) => {
              deniedBrowser = await chromium.launch({ proxy: options.proxy });
              return deniedBrowser;
            },
          )),
      );
    } finally {
      await deniedHandle?.cancel();
      await deniedBrowser?.close();
    }
    assert.equal(deniedBrowser!.isConnected(), false);
    assert.equal(idpRequests, beforeDenied);
    const canceled = await beginSignIn(
      p,
      "qa",
      "buyer",
      dir,
      async (_profile, _name, options) =>
        chromium.launch({ proxy: options.proxy }),
    );
    await canceled.cancel();
    await assert.rejects(() => canceled.finish());
    assert.equal((await readdir(dir)).length, 0);
  } finally {
    await capture.cancel();
    await new Promise<void>((r) => idp.close(() => r()));
    await new Promise<void>((r) => app.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("form MFA generates a current per-account TOTP without exposing the seed or code", async () => {
  const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url?.startsWith("/verify?code=")) {
      const code = new URL(req.url, "http://local").searchParams.get("code");
      res.writeHead(302, {
        "set-cookie":
          code === totp(seed) ? "mfa=yes; Path=/" : "mfa=no; Path=/",
        location: "/home",
      });
      res.end();
    } else if (req.url === "/home")
      res.end(
        req.headers.cookie?.includes("mfa=yes")
          ? "<h1>Verified</h1>"
          : "<h1>Not verified</h1>",
      );
    else if (req.url === "/mfa")
      res.end(
        '<form action="/verify"><label>Authentication code<input name="code"></label><button>Verify</button></form>',
      );
    else
      res.end(
        '<label>Username<input></label><label>Password<input type="password"></label><button onclick="location.href=\'/mfa\'">Sign in</button>',
      );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const p = sampleProject(4310);
  p.roles = { customer: { description: "Customer" } };
  p.environments = {
    qa: {
      baseURL: `http://127.0.0.1:${addr.port}/`,
      data: {},
      users: {
        buyer: {
          role: "customer",
          username: "qa-user",
          passwordEnv: "SUPERQ_MFA_TEST_PASSWORD",
          totpSecretEnv: "SUPERQ_MFA_TEST_SEED",
        },
      },
      defaultUser: "buyer",
      login: {
        path: "login",
        usernameLabel: "Username",
        passwordLabel: "Password",
        submitButton: "Sign in",
        successPath: "home",
        mfa: { codeLabel: "Authentication code", submitButton: "Verify" },
      },
    },
  };
  p.execution.testIds = ["TC-102"];
  p.locators.verified = { strategy: "text", value: "Verified" };
  p.tests.find((t) => t.id === "TC-102")!.steps = [
    {
      action: "browser.journey",
      save: {},
      input: {
        commands: [
          { type: "goto", path: "home" },
          { type: "expectText", locator: "verified", value: "Verified" },
        ],
      },
      assertions: [
        { path: "text.verified", operator: "equals", expected: "Verified" },
      ],
    },
  ];
  const priorSeed = process.env.SUPERQ_MFA_TEST_SEED,
    priorPassword = process.env.SUPERQ_MFA_TEST_PASSWORD;
  process.env.SUPERQ_MFA_TEST_SEED = seed;
  process.env.SUPERQ_MFA_TEST_PASSWORD = "fixture-password";
  const adapters = createAdapters();
  try {
    const results = await run(p, "qa", "regression", adapters.registry);
    assert.equal(results[0]!.status, "passed");
    assert.ok(!JSON.stringify(results).includes(seed));
    delete process.env.SUPERQ_MFA_TEST_SEED;
    assert.equal(
      (await run(p, "qa", "regression", adapters.registry))[0]!.status,
      "blocked",
    );
  } finally {
    if (priorSeed === undefined) delete process.env.SUPERQ_MFA_TEST_SEED;
    else process.env.SUPERQ_MFA_TEST_SEED = priorSeed;
    if (priorPassword === undefined)
      delete process.env.SUPERQ_MFA_TEST_PASSWORD;
    else process.env.SUPERQ_MFA_TEST_PASSWORD = priorPassword;
    await adapters.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("capture proxy permits only listed HTTPS tunnel destinations", async () => {
  const { createServer, connect } = await import("node:net");
  const { openAuthProxy } = await import("../src/auth-proxy.js");
  let reached = 0;
  const upstream = createServer((socket) => {
    let request = "";
    socket.on("data", (data) => {
      request += data.toString();
      if (request.length >= 4) {
        reached++;
        assert.equal(request, "PING");
        socket.end("PONG");
      }
    });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const addr = upstream.address();
  assert.ok(addr && typeof addr !== "string");
  const proxy = await openAuthProxy(
    new Set([`https://127.0.0.1:${addr.port}`]),
  );
  const exchange = (destination: string, ping: boolean) =>
    new Promise<string>((resolve, reject) => {
      const url = new URL(proxy.proxy.server);
      const socket = connect(Number(url.port), url.hostname, () =>
        socket.write(
          `CONNECT ${destination} HTTP/1.1\r\nHost: ${destination}\r\n\r\n`,
        ),
      );
      let data = "",
        sent = false;
      socket.setTimeout(3000, () =>
        socket.destroy(new Error("Proxy test timed out")),
      );
      socket.on("error", reject);
      socket.on("data", (chunk) => {
        data += chunk.toString();
        if (ping && !sent && data.includes("\r\n\r\n")) {
          sent = true;
          socket.write("PING");
        }
        if (ping && data.endsWith("PONG")) socket.end();
      });
      socket.on("end", () => resolve(data));
    });
  try {
    assert.match(
      await exchange(`127.0.0.1:${addr.port}`, true),
      /200 Connection Established[\s\S]*PONG/,
    );
    assert.match(await exchange("blocked.invalid:443", false), /403 Forbidden/);
    assert.equal(reached, 1);
  } finally {
    await proxy.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  }
});
