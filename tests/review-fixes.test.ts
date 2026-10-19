import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAdapters } from "../src/adapters.js";
import { validateProject } from "../src/model.js";
import { run, type Context } from "../src/runner.js";
import { isReviewCurrent, reviewFingerprint } from "../src/identity.js";
import { DatabaseLifecycle } from "../src/database-lifecycle.js";
async function project() {
  return validateProject(
    JSON.parse(await readFile("examples/project.json", "utf8")),
  );
}
async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close(server: ReturnType<typeof createServer>) {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
for (const browser of (process.env.SUPERQ_TEST_BROWSERS ?? "chromium").split(
  ",",
))
  test(`${browser} denies redirects, redirected POST, frames, popups and WebSockets before unapproved destination receives data`, async () => {
    let external = 0;
    const denied = createServer((_req, res) => {
      external++;
      res.end("Service healthy");
    });
    denied.on("upgrade", (_req, socket) => {
      external++;
      socket.destroy();
    });
    const remote = await listen(denied);
    const app = createServer((req, res) => {
      if (req.url === "/scheme") {
        res.writeHead(307, { location: `https://${req.headers.host}/ok` });
        res.end();
        return;
      }
      if (req.url === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: Service healthy\n\n");
        return;
      }
      if (req.url === "/redirect") {
        res.writeHead(302, { location: remote });
        res.end();
        return;
      }
      if (req.url === "/post") {
        res.writeHead(307, { location: remote });
        res.end();
        return;
      }
      if (req.url === "/allowed-redirect") {
        res.writeHead(302, { location: "/ok" });
        res.end();
        return;
      }
      res.setHeader("content-type", "text/html");
      const script =
        req.url === "/allowed-stream"
          ? `const e=new EventSource("/events");e.onmessage=m=>{document.querySelector("p").textContent=m.data;e.close();};`
          : req.url === "/allowed-ws"
            ? `const s=new WebSocket(location.origin.replace('http:','ws:'));s.onopen=()=>{document.querySelector('p').textContent='Service healthy';s.close();};`
            : req.url === "/ws"
              ? `const s=new WebSocket('${remote.replace("http:", "ws:")}');s.onerror=()=>document.querySelector('p').textContent='Service healthy';`
              : req.url === "/fetch"
                ? `fetch('/post',{method:'POST',body:'SYNTHETIC'}).catch(()=>document.querySelector('p').textContent='Service healthy');`
                : req.url === "/frame"
                  ? `const f=document.createElement('iframe');f.src='${remote}';document.body.append(f);setTimeout(()=>document.querySelector('p').textContent='Service healthy',200);`
                  : req.url === "/popup"
                    ? `window.open('${remote}');setTimeout(()=>document.querySelector('p').textContent='Service healthy',200);`
                    : "";
      res.end(
        `<p data-testid="health-status">${script ? "Loading" : "Service healthy"}</p><script>${script}</script>`,
      );
    });
    let unexpectedTLS = 0;
    app.on("clientError", (_error, socket) => {
      unexpectedTLS++;
      socket.destroy();
    });
    app.on("upgrade", (req, socket) => {
      const accept = createHash("sha1")
        .update(
          String(req.headers["sec-websocket-key"]) +
            "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
        )
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.on("data", () => socket.destroy());
    });
    const url = await listen(app),
      p = await project();
    p.environments.local!.baseURL = url;
    const step = p.tests[1]!.steps[0]!;
    const adapters = createAdapters({ provider: "local", browser });
    try {
      for (const path of [
        "/redirect",
        "/scheme",
        "/fetch",
        "/ws",
        "/frame",
        "/popup",
        "/allowed-ok",
        "/allowed-redirect",
        "/allowed-ws",
        "/allowed-stream",
      ]) {
        step.input.commands = [
          { type: "goto", path },
          {
            type: "expectText",
            locator: "health-status",
            value: "Service healthy",
            timeoutMs: 1500,
          },
        ];
        const result = (
          await run(p, "local", "browser", adapters.registry)
        )[0]!;
        assert.equal(
          result.status,
          path.startsWith("/allowed-") &&
            !(
              browser === "webkit" &&
              ["/allowed-redirect", "/allowed-stream"].includes(path)
            )
            ? "passed"
            : "failed",
          path,
        );
        assert.equal(external, 0, path);
        assert.equal(unexpectedTLS, 0, path);
      }
    } finally {
      await adapters.close();
      await close(app);
      await close(denied);
    }
  });
test("review digest binds direct locators and action definitions, preserving unrelated catalog changes", async () => {
  const p = await project(),
    t = p.tests[1]!;
  t.review = {
    reviewer: "QE",
    at: new Date().toISOString(),
    digest: reviewFingerprint(p, t),
  };
  assert.ok(isReviewCurrent(p, t));
  p.locators.unused = { strategy: "testId", value: "unused" };
  assert.ok(isReviewCurrent(p, t));
  p.locators["health-status"]!.value = "other-control";
  assert.ok(!isReviewCurrent(p, t));
  t.review.digest = reviewFingerprint(p, t);
  p.catalog.find((a) => a.id === t.steps[0]!.action)!.operation = "changed";
  assert.ok(!isReviewCurrent(p, t));
});

type Factories = NonNullable<Parameters<typeof createAdapters>[4]>;
const noFactories: Factories = {
  postgres: () => {
    throw new Error("Unexpected postgres");
  },
  mongo: () => {
    throw new Error("Unexpected mongo");
  },
  snowflake: () => {
    throw new Error("Unexpected snowflake");
  },
};
async function context(signal: AbortSignal): Promise<Context> {
  return {
    project: await project(),
    baseURL: "http://127.0.0.1",
    data: {},
    signal,
  };
}
function secrets() {
  const keys = [
    "SUPERQ_POSTGRES_URL",
    "SUPERQ_MONGO_URL",
    "SUPERQ_SNOWFLAKE_ACCOUNT",
    "SUPERQ_SNOWFLAKE_USER",
    "SUPERQ_SNOWFLAKE_PASSWORD",
    "SUPERQ_SNOWFLAKE_READ_ROLE",
    "SUPERQ_SNOWFLAKE_WAREHOUSE",
  ];
  const before = keys.map((k) => process.env[k]);
  keys.forEach((k) => (process.env[k] = "fixture"));
  return () =>
    keys.forEach((k, i) => {
      if (before[i] === undefined) delete process.env[k];
      else process.env[k] = before[i];
    });
}
test("Snowflake abort cancels active statement and close waits for destruction", async () => {
  const restore = secrets();
  let executed = false,
    cancelled = 0,
    destroyed = 0;
  const db = {
    connect: (cb: (err?: Error) => void) => {
      cb();
    },
    execute: (options: { parameters: Record<string, number> }) => {
      executed = true;
      assert.equal(options.parameters.STATEMENT_TIMEOUT_IN_SECONDS, 30);
      return {
        cancel: (cb: (err?: Error) => void) => {
          cancelled++;
          cb();
        },
      };
    },
    destroy: (cb: () => void) => {
      setTimeout(() => {
        destroyed++;
        cb();
      }, 30);
    },
  };
  const adapters = createAdapters(undefined, undefined, undefined, undefined, {
    ...noFactories,
    snowflake: () => db as unknown as ReturnType<Factories["snowflake"]>,
  });
  const abort = new AbortController();
  try {
    const running = adapters.registry.get("snowflake:query")(
      { query: "SELECT 1" },
      await context(abort.signal),
    );
    const rejection = assert.rejects(running, /cancelled/);
    await new Promise((r) => setImmediate(r));
    assert.ok(executed);
    abort.abort();
    await adapters.close();
    await rejection;
    assert.equal(cancelled, 1);
    assert.equal(destroyed, 1);
  } finally {
    restore();
  }
});
test("postgres and mongo abort close owned resources and prevent late results", async () => {
  const restore = secrets();
  try {
    for (const kind of ["postgres", "mongo"]) {
      let connected = false,
        closed = 0;
      let querySignal: AbortSignal | undefined;
      const pg = {
        connect: async () => {
          connected = true;
        },
        query: async (sql: string) =>
          sql === "BEGIN READ ONLY"
            ? {}
            : sql.includes("pg_backend_pid")
              ? { rows: [{ pid: 123 }] }
              : sql.includes("pg_cancel_backend")
                ? { rows: [{ cancelled: true }] }
                : new Promise(() => {}),
        end: async () => {
          closed++;
        },
      };
      const mongo = {
        connect: async () => {
          connected = true;
        },
        db: () => ({
          collection: () => ({
            find: (_filter: unknown, options: { signal: AbortSignal }) => {
              querySignal = options.signal;
              return {
                limit: () => ({ toArray: async () => new Promise(() => {}) }),
              };
            },
          }),
        }),
        close: async () => {
          closed++;
        },
      };
      const adapters = createAdapters(
        undefined,
        undefined,
        undefined,
        undefined,
        {
          ...noFactories,
          postgres: () => pg as unknown as ReturnType<Factories["postgres"]>,
          mongo: () => mongo as unknown as ReturnType<Factories["mongo"]>,
        },
      );
      const abort = new AbortController();
      const task = adapters.registry.get(
        kind === "postgres" ? "postgres:query" : "mongo:find",
      )(
        kind === "postgres"
          ? { query: "SELECT 1" }
          : { database: "test", collection: "items" },
        await context(abort.signal),
      );
      const rejection = assert.rejects(task, /cancelled/);
      await new Promise((r) => setImmediate(r));
      assert.ok(connected);
      abort.abort();
      await adapters.close();
      await rejection;
      assert.equal(closed, kind === "postgres" ? 2 : 1);
      if (kind === "mongo") assert.ok(querySignal?.aborted);
    }
  } finally {
    restore();
  }
});
test("cleanup timeouts are retained and reported rather than claiming cancellation succeeded", async () => {
  const lifecycle = new DatabaseLifecycle(15),
    abort = new AbortController();
  const task = lifecycle.run(
    abort.signal,
    async () => new Promise(() => {}),
    async () => new Promise(() => {}),
  );
  const rejected = assert.rejects(task, /unconfirmed/);
  abort.abort();
  await assert.rejects(lifecycle.close(), /unconfirmed/);
  await rejected;
});

test("Studio remains running through cleanup and never publishes proof when cancellation is unconfirmed", async () => {
  const { startWorkspace } = await import("../src/workspace-server.js");
  const { Registry } = await import("../src/runner.js");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "superq-cleanup-"));
  let cleanupStarted = false,
    finish!: () => void;
  const cleanup = new Promise<void>((_resolve, reject) => {
    finish = () => reject(new Error("fixture cleanup failure"));
  });
  // Observe rejection immediately, while retaining the original promise for close().
  void cleanup.catch(() => {});
  const app = await startWorkspace({
    port: 0,
    file: join(dir, "state.json"),
    adapterFactory: () => ({
      registry: new Registry().register("api:request", async () => ({
        status: 200,
        body: { status: "ok" },
      })),
      close: () => {
        cleanupStarted = true;
        return cleanup;
      },
    }),
  });
  const get = async () =>
    await (await fetch(`${app.url}/api/workspace`)).json();
  const post = async (path: string, body: Record<string, unknown>) => {
    const s = await get();
    const response = await fetch(`${app.url}/api/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-superq-token": s.token,
      },
      body: JSON.stringify({ ...body, revision: s.revision }),
    });
    assert.ok(response.ok, await response.text());
  };
  try {
    await post("import", { project: await project() });
    await post("runs", {
      environment: "local",
      suite: "smoke",
      profile: "local",
      workers: 1,
    });
    for (let i = 0; i < 100 && !cleanupStarted; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(cleanupStarted);
    assert.equal((await get()).runs[0].state, "running");
    assert.equal((await get()).runs[0].report, undefined);
    finish();
    let state = await get();
    for (let i = 0; i < 100 && state.runs[0].state === "running"; i++) {
      await new Promise((r) => setTimeout(r, 10));
      state = await get();
    }
    assert.equal(state.runs[0].state, "failed");
    assert.equal(state.runs[0].report, undefined);
    assert.match(state.runs[0].error, /unconfirmed/);
  } finally {
    finish();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a late Snowflake connection after abort is destroyed without starting a query", async () => {
  const restore = secrets();
  let connected!: () => void,
    queries = 0,
    destroyed = 0;
  const db = {
    connect: (cb: () => void) => {
      connected = cb;
    },
    execute: () => {
      queries++;
      throw new Error("Must not execute");
    },
    destroy: (cb: () => void) => {
      destroyed++;
      cb();
    },
  };
  const adapters = createAdapters(undefined, undefined, undefined, undefined, {
    ...noFactories,
    snowflake: () => db as unknown as ReturnType<Factories["snowflake"]>,
  });
  const abort = new AbortController();
  try {
    const operation = adapters.registry.get("snowflake:query")(
      { query: "SELECT 1" },
      await context(abort.signal),
    );
    const rejected = assert.rejects(operation, /cancelled/);
    abort.abort();
    await adapters.close();
    await rejected;
    connected();
    await new Promise((r) => setImmediate(r));
    assert.equal(queries, 0);
    assert.equal(destroyed, 2);
  } finally {
    restore();
  }
});

test("buffered cloud fallback rejects same-origin redirect chains before a later foreign hop", async () => {
  const { chromium } = await import("@playwright/test");
  const { restrictBrowserOrigin } = await import("../src/browser-policy.js");
  let foreignHits = 0,
    secondHopHits = 0;
  const foreign = createServer((_req, res) => {
    foreignHits++;
    res.end("leaked");
  });
  const destination = await listen(foreign);
  const app = createServer((req, res) => {
    if (req.url === "/two") secondHopHits++;
    res.writeHead(302, { location: req.url === "/one" ? "/two" : destination });
    res.end();
  });
  const origin = await listen(app);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const policy = await restrictBrowserOrigin(context, origin);
    const page = await context.newPage();
    await assert.rejects(page.goto(origin + "/one"));
    assert.throws(() => policy.assertAllowed(), /origin policy/);
    assert.equal(secondHopHits, 0);
    assert.equal(foreignHits, 0);
  } finally {
    await browser.close();
    await close(app);
    await close(foreign);
  }
});
