import { join, dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { readFile, access } from "node:fs/promises";
import { chromium, firefox, webkit } from "@playwright/test";
import type { Project } from "./model.js";
import { cloudCredentialNames } from "./browser.js";
import { catalogHealth } from "./catalog.js";
const require = createRequire(import.meta.url);
export async function frameworkHealth(project: Project, root = process.cwd()) {
  let locked: Record<string, { version?: string }> = {};
  try {
    locked =
      JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"))
        .packages ?? {};
  } catch {}
  const packages = ["@playwright/test", "@modelcontextprotocol/sdk", "zod"].map(
    (name) => {
      let installed: string | null = null;
      try {
        installed = (require(`${name}/package.json`) as { version: string })
          .version;
        if (typeof installed !== "string")
          throw new Error("Package metadata export is unavailable");
      } catch {
        if (name === "@modelcontextprotocol/sdk")
          try {
            installed = (
              require(
                resolve(
                  dirname(require.resolve(`${name}/server/mcp.js`)),
                  "../../../package.json",
                ),
              ) as { version: string }
            ).version;
          } catch {}
      }
      const lock = locked[`node_modules/${name}`]?.version ?? null;
      return {
        name,
        installed,
        locked: lock,
        status: !installed
          ? "missing"
          : !lock
            ? "lock-unknown"
            : lock !== installed
              ? "version-drift"
              : "aligned",
      };
    },
  );
  const browsers = await Promise.all(
    Object.entries(project.browsers).map(async ([name, profile]) => {
      if (profile.provider !== "local")
        return {
          name,
          provider: profile.provider,
          browser: profile.browser,
          status: "live-validation-required",
          missingCredentialNames: cloudCredentialNames(profile).filter(
            (key) => !process.env[key],
          ),
        };
      if (["chrome", "edge"].includes(profile.browser))
        return {
          name,
          provider: profile.provider,
          browser: profile.browser,
          status: "installed-channel-validation-required",
          missingCredentialNames: [],
        };
      const engine =
        profile.browser === "firefox"
          ? firefox
          : profile.browser === "webkit"
            ? webkit
            : chromium;
      let installed = false;
      try {
        await access(engine.executablePath());
        installed = true;
      } catch {}
      return {
        name,
        provider: profile.provider,
        browser: profile.browser,
        status: installed ? "binary-present" : "browser-install-required",
        missingCredentialNames: [],
      };
    }),
  );
  const supported = new Set([
    "api:request",
    "web:journey",
    "postgres:query",
    "mongo:find",
    "snowflake:query",
  ]);
  return {
    node: process.versions.node,
    nodeSupported:
      Number(process.versions.node.split(".")[0])! > 22 ||
      (Number(process.versions.node.split(".")[0]) === 22 &&
        Number(process.versions.node.split(".")[1]) >= 12),
    packages,
    browsers,
    unsupportedStudioActions: project.catalog
      .filter((a) => !supported.has(`${a.kind}:${a.operation}`))
      .map((a) => a.id),
    catalog: catalogHealth(project),
    checks: [
      "Review dependency/lockfile changes in a pull request",
      "Install the browser binaries matching the pinned Playwright version",
      "Run strict typechecks, framework tests and a representative application canary",
      "Review cloud/tunnel, account and integration compatibility before adopting the upgrade",
    ],
    notice:
      "Local diagnostics only. No package upgrade, browser download, cloud session or vulnerability scan is performed. A present binary is not proof of runtime compatibility. Custom actions require an owned programmatic registry.",
  };
}
