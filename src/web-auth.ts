import { expect, type Page } from "@playwright/test";
import { AuthenticationRequired, totp } from "./auth-session.js";
import { interpolate, resolveAccount, type Context } from "./runner.js";
import type { Project } from "./model.js";
import { ensureAction } from "./catalog.js";
/** Identical application authentication for execution and recording; no event instrumentation. */
export async function authenticatePage(page: Page, ctx: Context) {
  const origin = new URL(ctx.baseURL).origin;
  if (ctx.account && ctx.sso) {
    try {
      await page.goto(new URL(ctx.sso.successPath, ctx.baseURL).href);
      await expect(page).toHaveURL(
        new URL(ctx.sso.successPath, ctx.baseURL).href,
        { timeout: 5000 },
      );
      await expect(
        page.getByText(String(interpolate(ctx.sso.successText, ctx.data)), {
          exact: true,
        }),
      ).toBeVisible({ timeout: 5000 });
    } catch {
      throw new AuthenticationRequired();
    }
  }
  if (ctx.account && ctx.login) {
    try {
      if (!ctx.account.username || !ctx.account.password)
        throw new Error(
          "Login requires configured username and password secret",
        );
      const loginURL = new URL(ctx.login.path, ctx.baseURL),
        successURL = new URL(ctx.login.successPath, ctx.baseURL);
      if (loginURL.origin !== origin || successURL.origin !== origin)
        throw new Error("Cross-origin login denied");
      await page.goto(loginURL.href);
      await page
        .getByLabel(ctx.login.usernameLabel, { exact: true })
        .fill(ctx.account.username);
      await page
        .getByLabel(ctx.login.passwordLabel, { exact: true })
        .fill(ctx.account.password);
      await page
        .getByRole("button", { name: ctx.login.submitButton, exact: true })
        .click();
      if (ctx.login.mfa) {
        await page
          .getByLabel(ctx.login.mfa.codeLabel, { exact: true })
          .waitFor({ state: "visible" });
        if (!ctx.account.mfaSecret)
          throw new AuthenticationRequired(
            "Configure the TOTP seed secret for this test account.",
          );
        await page
          .getByLabel(ctx.login.mfa.codeLabel, { exact: true })
          .fill(totp(ctx.account.mfaSecret, ctx.login.mfa));
        await page
          .getByRole("button", {
            name: ctx.login.mfa.submitButton,
            exact: true,
          })
          .click();
      }
      await expect(page).toHaveURL(successURL.href);
    } catch {
      throw new AuthenticationRequired(
        "Form sign-in or MFA was not accepted. Check the account, authentication settings and provider response.",
      );
    }
  }
}
export function recordingContext(
  project: Project,
  environment: string,
  selection: { role?: string; user?: string; anonymous?: boolean },
): Context {
  const p = structuredClone(project),
    env = p.environments[environment];
  if (!env) throw new Error("Unknown environment");
  const action = ensureAction(p, "web", "journey", "Browser journey");
  const account = resolveAccount(p, environment, {
    id: "recording",
    title: "Recording",
    origin: "qe",
    status: "draft",
    ...selection,
    requirementIds: [],
    evidenceIds: [],
    covers: {},
    suites: [],
    tags: [],
    retrySafe: false,
    dependsOn: [],
    blockedBy: [],
    data: {},
    steps: [{ action, input: {}, assertions: [], save: {} }],
  });
  if (!selection.anonymous && (env.sso || env.login) && !account)
    throw new AuthenticationRequired(
      "Select an environment account before recording",
    );
  return {
    project,
    environment,
    baseURL: env.baseURL,
    account,
    sso: selection.anonymous ? undefined : env.sso,
    login: selection.anonymous ? undefined : env.login,
    data: {
      ...project.data,
      ...env.data,
      ...(account
        ? {
            "user.id": account.id,
            "user.role": account.role,
            "user.username": account.username,
            "user.password": account.password,
          }
        : {}),
    },
  };
}
