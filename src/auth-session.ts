import { z } from "zod";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  lstat,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { expect, type Browser } from "@playwright/test";
import { chromium } from "@playwright/test";
import { openAuthProxy } from "./auth-proxy.js";
import { BrowserProfile } from "./config.js";
import { canonical } from "./identity.js";
import type { Project } from "./model.js";

export const authDirectory = () =>
  resolve(process.env.SUPERQ_AUTH_DIR ?? ".superq/auth");
type State = Awaited<
  ReturnType<import("@playwright/test").BrowserContext["storageState"]>
>;
const Cookie = z
  .object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string(),
    expires: z.number(),
    httpOnly: z.boolean(),
    secure: z.boolean(),
    sameSite: z.enum(["Strict", "Lax", "None"]),
    partitionKey: z.string().optional(),
  })
  .strict();
const Session = z.object({
  version: z.literal(1),
  key: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  state: z.object({
    cookies: z.array(Cookie),
    origins: z.array(
      z.object({
        origin: z.string(),
        localStorage: z.array(
          z.object({ name: z.string(), value: z.string() }),
        ),
        indexedDB: z.array(z.unknown()).optional(),
      }),
    ),
  }),
});
export class AuthenticationRequired extends Error {
  constructor(
    message = "Sign in again: the SSO/MFA session is missing, expired or no longer accepted.",
  ) {
    super(message);
  }
}
export function authIdentity(p: Project, environment: string, user: string) {
  const env = p.environments[environment],
    account = env?.users?.[user];
  if (!env?.sso || !account)
    throw new AuthenticationRequired(
      "Configure SSO and a valid environment account first.",
    );
  const origin = new URL(env.baseURL).origin;
  const key = createHash("sha256")
    .update(
      canonical({
        project: p.name,
        environment,
        user,
        origin,
        baseURL: new URL(env.baseURL).href,
        role: account.role,
        username: account.username,
        sso: env.sso,
      }),
    )
    .digest("hex");
  return { env, account, origin, key };
}
export async function loadSession(
  p: Project,
  environment: string,
  user: string,
  directory = authDirectory(),
): Promise<State> {
  const { key } = authIdentity(p, environment, user);
  try {
    const path = join(directory, `${key}.json`),
      stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 2_000_000 ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    )
      throw new Error("Invalid session file");
    const session = Session.parse(JSON.parse(await readFile(path, "utf8")));
    if (
      session.key !== key ||
      Date.parse(session.expiresAt) <= Date.now() ||
      Date.parse(session.createdAt) > Date.now() + 5000
    )
      throw new Error("Expired session");
    return session.state as State;
  } catch {
    throw new AuthenticationRequired();
  }
}
export async function sessionStatus(
  p: Project,
  environment: string,
  user: string,
  directory = authDirectory(),
) {
  try {
    await loadSession(p, environment, user, directory);
    return "saved" as const;
  } catch {
    return "sign-in-required" as const;
  }
}
export async function revokeSession(
  p: Project,
  environment: string,
  user: string,
  directory = authDirectory(),
) {
  const { key } = authIdentity(p, environment, user);
  await unlink(join(directory, `${key}.json`)).catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT")
        throw new Error("Could not remove the saved session");
    },
  );
}
export async function beginSignIn(
  p: Project,
  environment: string,
  user: string,
  directory = authDirectory(),
  connector: (
    profile: BrowserProfile,
    name: string,
    options: { proxy: { server: string; bypass: string } },
  ) => Promise<Browser> = async (_profile, _name, options) =>
    chromium.launch({ headless: false, proxy: options.proxy }),
) {
  const { env, account, origin, key } = authIdentity(p, environment, user),
    cfg = env.sso!;
  const successText = cfg.successText.replace(/\$\{user\.username\}/g, () => {
    if (!account.username)
      throw new AuthenticationRequired(
        "Configure a username for the session identity check.",
      );
    return account.username;
  });
  const allowed = new Set([origin, ...cfg.allowedOrigins]);
  const network = await openAuthProxy(allowed);
  let browser: Browser;
  try {
    browser = await connector(
      BrowserProfile.parse({
        provider: "local",
        browser: "chromium",
        headless: false,
      }),
      "SuperQ SSO/MFA sign-in",
      { proxy: network.proxy },
    );
  } catch {
    await network.close();
    throw new AuthenticationRequired(
      "Could not launch the local sign-in browser.",
    );
  }
  let closed = false,
    finishing = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      clearTimeout(timer);
      await browser.close().catch(() => {});
      await network.close();
    }
  };
  const timer = setTimeout(() => void close(), 10 * 60_000);
  timer.unref();
  browser.on("disconnected", () => {
    closed = true;
    clearTimeout(timer);
    void network.close();
  });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", async (route) => {
      let ok = false;
      try {
        ok = allowed.has(new URL(route.request().url()).origin);
      } catch {}
      if (ok) await route.continue();
      else await route.abort();
    });
    const page = await context.newPage();
    await page.goto(new URL(cfg.startPath, env.baseURL).href, {
      timeout: 30000,
    });
    if (!allowed.has(new URL(page.url()).origin))
      throw new AuthenticationRequired();
    return {
      isClosed: () => closed,
      cancel: close,
      finish: async () => {
        if (closed || finishing)
          throw new AuthenticationRequired("Start a new sign-in session.");
        finishing = true;
        try {
          const signedInPage =
            context
              .pages()
              .find(
                (p) => p.url() === new URL(cfg.successPath, env.baseURL).href,
              ) ?? page;
          await expect(signedInPage).toHaveURL(
            new URL(cfg.successPath, env.baseURL).href,
            { timeout: 5000 },
          );
          await expect(
            signedInPage.getByText(successText, { exact: true }),
          ).toBeVisible({ timeout: 5000 });
          const state = await context.storageState({ indexedDB: true });
          // Keep application-applicable cookies and exact app-origin storage.
          state.cookies = state.cookies.filter((c) => {
            const domain = c.domain.replace(/^\./, "");
            const host = new URL(origin).hostname;
            return host === domain || host.endsWith(`.${domain}`);
          });
          state.origins = state.origins.filter((o) => o.origin === origin);
          const createdAt = new Date().toISOString(),
            expiresAt = new Date(
              Date.now() + cfg.maxAgeMinutes * 60000,
            ).toISOString();
          const payload = JSON.stringify(
            Session.parse({
              version: 1,
              key,
              createdAt,
              expiresAt,
              state,
            }),
          );
          if (Buffer.byteLength(payload) > 2_000_000)
            throw new Error("Session too large");
          if (closed) throw new AuthenticationRequired();
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const temp = join(
            directory,
            `.${key}-${randomBytes(8).toString("hex")}.tmp`,
          );
          try {
            await writeFile(temp, payload, { flag: "wx", mode: 0o600 });
            if (closed) throw new AuthenticationRequired();
            await rename(temp, join(directory, `${key}.json`));
          } finally {
            await unlink(temp).catch(() => {});
          }
          await close();
          return { expiresAt };
        } catch {
          finishing = false;
          throw new AuthenticationRequired(
            "Sign-in was not confirmed. Complete SSO/MFA and check the configured success page and text.",
          );
        }
      },
    };
  } catch {
    await close();
    throw new AuthenticationRequired(
      "Could not open sign-in. Check the application URL, allowed provider origins and local browser installation.",
    );
  }
}
/** RFC 6238 generation for explicitly configured test-account seeds. Never logs a seed/code. */
export function totp(
  seed: string,
  options: {
    digits?: 6 | 8;
    period?: number;
    algorithm?: "sha1" | "sha256" | "sha512";
    time?: number;
  } = {},
) {
  const clean = seed.replace(/[\s=-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]{16,256}$/.test(clean))
    throw new AuthenticationRequired("Invalid TOTP secret configuration");
  let bits = 0,
    value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(
    BigInt(
      Math.floor((options.time ?? Date.now()) / 1000 / (options.period ?? 30)),
    ),
  );
  const digest = createHmac(options.algorithm ?? "sha1", Buffer.from(bytes))
      .update(counter)
      .digest(),
    offset = digest[digest.length - 1]! & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** (options.digits ?? 6),
  ).padStart(options.digits ?? 6, "0");
}
