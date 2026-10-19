import { chromium, firefox, webkit, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { BrowserProfile } from "./config.js";
const require = createRequire(import.meta.url);
const version = (
  require("@playwright/test/package.json") as { version: string }
).version;
function secret(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key];
  if (!value) throw new Error(`Missing cloud credential: ${key}`);
  return value;
}
/** Credentials exist only in the endpoint sent to the provider; never serialize/log it. */
export function cloudEndpoint(
  profile: BrowserProfile,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (profile.provider === "local")
    throw new Error("Local profile has no cloud endpoint");
  const browser = {
    chromium: "playwright-chromium",
    firefox: "playwright-firefox",
    webkit: "playwright-webkit",
    chrome: "chrome",
    edge: "edge",
  }[profile.browser];
  if (profile.provider === "browserstack") {
    const caps = {
      browser,
      ...(["chrome", "edge"].includes(profile.browser)
        ? { browser_version: profile.browserVersion }
        : {}),
      os: profile.os,
      os_version: profile.osVersion,
      project: profile.project,
      build: profile.build,
      name,
      "browserstack.username": secret(env, "BROWSERSTACK_USERNAME"),
      "browserstack.accessKey": secret(env, "BROWSERSTACK_ACCESS_KEY"),
      "client.playwrightVersion": version,
      "browserstack.video": profile.video,
      "browserstack.networkLogs": profile.networkLogs,
      ...(profile.localIdentifier
        ? {
            "browserstack.local": true,
            "browserstack.localIdentifier": profile.localIdentifier,
          }
        : {}),
    };
    return `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;
  }
  const caps = {
    browserName: {
      chromium: "pw-chromium",
      firefox: "pw-firefox",
      webkit: "pw-webkit",
      chrome: "Chrome",
      edge: "MicrosoftEdge",
    }[profile.browser],
    browserVersion: profile.browserVersion,
    "LT:Options": {
      platform: profile.platform,
      build: profile.build,
      project: profile.project,
      name,
      user: secret(env, "LT_USERNAME"),
      accessKey: secret(env, "LT_ACCESS_KEY"),
      video: profile.video,
      network: profile.networkLogs,
      ...(profile.tunnelName
        ? { tunnel: true, tunnelName: profile.tunnelName }
        : {}),
      playwrightClientVersion: version,
    },
  };
  return `wss://cdp.lambdatest.com/playwright?capabilities=${encodeURIComponent(JSON.stringify(caps))}`;
}
export async function openBrowser(
  profile: BrowserProfile,
  name: string,
  proxy?: { server: string; bypass?: string },
): Promise<Browser> {
  if (profile.provider !== "local")
    return chromium.connect({
      wsEndpoint: cloudEndpoint(profile, name),
      timeout: 30_000,
    });
  const engine =
    profile.browser === "firefox"
      ? firefox
      : profile.browser === "webkit"
        ? webkit
        : chromium;
  return engine.launch({
    proxy,
    headless: profile.headless,
    ...(profile.browser === "chrome"
      ? { channel: "chrome" }
      : profile.browser === "edge"
        ? { channel: "msedge" }
        : {}),
  });
}
export function cloudCredentialNames(profile: BrowserProfile) {
  return profile.provider === "browserstack"
    ? ["BROWSERSTACK_USERNAME", "BROWSERSTACK_ACCESS_KEY"]
    : profile.provider === "lambdatest"
      ? ["LT_USERNAME", "LT_ACCESS_KEY"]
      : [];
}
