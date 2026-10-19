import { access } from "node:fs/promises";
import { chromium, firefox, webkit } from "@playwright/test";
import { z } from "zod";
import type { Project } from "./model.js";
import { isReviewCurrent } from "./identity.js";
import { resolveAccount, resolveData, selectTests } from "./runner.js";
import { journeyCommands } from "./web-setups.js";
import { cloudCredentialNames } from "./browser.js";
import { sessionStatus, authDirectory } from "./auth-session.js";
export const RunRequest = z.object({
  environment: z.string(),
  user: z.string().min(1).optional(),
  suite: z.string(),
  profile: z.string(),
  workers: z.number().int().min(1).max(16),
  testIds: z.array(z.string()).default([]),
  validateDrafts: z.boolean().default(false),
  acknowledgeCloud: z.boolean().optional(),
  captureTrace: z.boolean().default(false),
  acknowledgeSensitiveTrace: z.boolean().default(false),
});
export type RunRequest = z.infer<typeof RunRequest>;
export function prepareRun(
  project: Project,
  input: RunRequest,
  intakeTrial = false,
) {
  if (
    !Object.hasOwn(project.environments, input.environment) ||
    !Object.hasOwn(project.suites, input.suite) ||
    !Object.hasOwn(project.browsers, input.profile)
  )
    throw new Error("Unknown run configuration");
  const p = structuredClone(project);
  if (intakeTrial)
    Object.assign(p.execution, {
      includeTags: [],
      excludeTags: [],
      shard: undefined,
      retries: 0,
      maxFailures: 0,
      failOnFlaky: true,
    });
  Object.assign(p.execution, {
    workers: input.workers,
    user: input.user,
    testIds: input.testIds,
  });
  const selection = selectTests(p, input.suite, p.execution);
  if (!selection.roots.length)
    throw new Error("No tests selected; check suite, tags, test IDs or shard");
  if (input.validateDrafts)
    for (const t of selection.tests)
      if (t.status === "draft") {
        t.status = "approved";
        delete t.review;
      }
  return { project: p, selection };
}
export type RunIssue = {
  testId?: string;
  kind: string;
  message: string;
  target: string;
};
export async function runPreflight(
  project: Project,
  input: RunRequest,
  options: {
    sessionDirectory?: string;
    pendingTestIds?: string[];
    intakeError?: string;
  } = {},
) {
  const issues: RunIssue[] = [],
    warnings: RunIssue[] = [];
  const add = (
    testId: string | undefined,
    kind: string,
    message: string,
    target: string,
  ) => issues.push({ testId, kind, message, target });
  let prepared: ReturnType<typeof prepareRun>;
  try {
    prepared = prepareRun(project, input);
  } catch {
    add(
      undefined,
      "selection",
      "Choose a valid environment, suite, profile and non-empty test selection.",
      "tests",
    );
    return {
      roots: [] as string[],
      tests: [] as {
        id: string;
        title: string;
        dependency: boolean;
        status: string;
      }[],
      issues,
      warnings,
      canStart: false,
      scope:
        "Configuration check only; no browser, application, model or cloud session was started.",
    };
  }
  const { project: p, selection } = prepared,
    env = p.environments[input.environment]!,
    profile = p.browsers[input.profile]!;
  if (options.intakeError)
    add(undefined, "intake", options.intakeError, "intake");
  if (profile.provider !== "local") {
    if (input.workers > profile.maxSessions)
      add(
        undefined,
        "cloud-limit",
        "Parallel workers exceed this cloud profile session limit.",
        "connections",
      );
    const missing = cloudCredentialNames(profile).filter(
      (k) => !process.env[k],
    );
    if (missing.length)
      add(
        undefined,
        "cloud-credentials",
        `Missing credential references: ${missing.join(", ")}.`,
        "connections",
      );
    warnings.push({
      kind: "cloud",
      message:
        "Execution uses your cloud account and may incur charges. This preview does not verify provider access or tunnels.",
      target: "connections",
    });
  }
  const hasWeb = selection.tests.some((t) =>
    t.steps.some(
      (s) => p.catalog.find((a) => a.id === s.action)?.kind === "web",
    ),
  );
  if (hasWeb && profile.provider === "local") {
    if (["chrome", "edge"].includes(profile.browser))
      warnings.push({
        kind: "browser-channel",
        message:
          "Installed Chrome/Edge channel availability is verified when execution launches.",
        target: "quality",
      });
    else {
      const engine =
        profile.browser === "firefox"
          ? firefox
          : profile.browser === "webkit"
            ? webkit
            : chromium;
      try {
        await access(engine.executablePath());
      } catch {
        add(
          undefined,
          "browser-install",
          "Install the selected Playwright browser before web execution.",
          "quality",
        );
      }
    }
  }
  const tests: {
    id: string;
    title: string;
    dependency: boolean;
    status: string;
  }[] = [];
  for (const t of selection.tests) {
    const start = issues.length;
    if (options.pendingTestIds?.includes(t.id))
      add(
        t.id,
        "maintenance",
        "Resolve pending source changes before running this case.",
        "maintenance",
      );
    if (t.status === "draft") {
      warnings.push({
        testId: t.id,
        kind: "draft",
        message:
          "This draft will be skipped unless exploratory validation is selected.",
        target: "tests",
      });
      tests.push({
        id: t.id,
        title: t.title,
        dependency: !selection.roots.includes(t.id),
        status: "skipped",
      });
      continue;
    }
    if (!isReviewCurrent(p, t))
      warnings.push({
        testId: t.id,
        kind: "review",
        message:
          "The current definition has no matching review; results cannot provide reviewed proof.",
        target: "tests",
      });
    if (t.blockedBy.length)
      add(t.id, "blocker", `Case blockers: ${t.blockedBy.join("; ")}`, "tests");
    if (!t.steps.length || !t.steps.some((s) => s.assertions.length))
      add(
        t.id,
        "assertions",
        "Add executable steps and explicit assertions.",
        "tests",
      );
    let account: ReturnType<typeof resolveAccount>;
    try {
      account = resolveAccount(p, input.environment, t, input.user);
    } catch {
      add(
        t.id,
        "account",
        "The required role, account or process secret is unavailable. Check environment account settings.",
        "environments",
      );
    }
    if (
      account &&
      env.sso &&
      t.steps.some(
        (s) => p.catalog.find((a) => a.id === s.action)?.kind === "web",
      ) &&
      (await sessionStatus(
        p,
        input.environment,
        account.id,
        options.sessionDirectory ?? authDirectory(),
      )) !== "saved"
    )
      add(
        t.id,
        "sso",
        "Complete sign-in for this account and environment. Saved-session acceptance is verified during execution.",
        "environments",
      );
    const data = {
      ...resolveData(p, input.environment, input.suite, t.data),
      ...env.testData?.[t.id],
      ...(account
        ? {
            "user.id": account.id,
            "user.role": account.role,
            "user.username": account.username,
            "user.password": account.password,
            "user.token": account.token,
          }
        : {}),
      "url.web": env.baseURL,
      "url.api": env.apiURL ?? env.baseURL,
      ...Object.fromEntries(
        Object.entries(env.urls ?? {}).map(([k, v]) => [`url.${k}`, v]),
      ),
      "superq.testId": t.id,
      "superq.attempt": 1,
      "superq.runId": "preview",
      "superq.environment": input.environment,
      "superq.suite": input.suite,
    };
    const available = new Set(
      Object.entries(data)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k),
    );
    for (const [index, s] of t.steps.entries()) {
      const action = p.catalog.find((a) => a.id === s.action)!;
      let web: unknown = [];
      if (action.kind === "web" && action.operation === "journey")
        try {
          web = journeyCommands(p, s.input).map((e) => ({
            ...e,
            definition:
              "locator" in e.command
                ? p.locators[e.command.locator]
                : undefined,
          }));
          const entries = journeyCommands(p, s.input);
          if (
            entries.some(
              (e) =>
                "locator" in e.command &&
                !Object.hasOwn(p.locators, e.command.locator),
            )
          )
            add(
              t.id,
              "locator",
              `Step ${index + 1} references a missing catalog control.`,
              "tests",
            );
        } catch {
          add(
            t.id,
            "commands",
            `Step ${index + 1} has an invalid browser command or setup reference.`,
            "tests",
          );
        }
      if (
        action.kind === "custom" ||
        ![
          "api:request",
          "web:journey",
          "postgres:query",
          "mongo:find",
          "snowflake:query",
        ].includes(`${action.kind}:${action.operation}`)
      )
        add(
          t.id,
          "adapter",
          `Step ${index + 1} needs an owned adapter that Studio does not currently register.`,
          "quality",
        );
      const secretNames =
        action.kind === "postgres"
          ? ["SUPERQ_POSTGRES_URL"]
          : action.kind === "mongo"
            ? ["SUPERQ_MONGO_URL"]
            : action.kind === "snowflake"
              ? [
                  "SUPERQ_SNOWFLAKE_ACCOUNT",
                  "SUPERQ_SNOWFLAKE_USER",
                  "SUPERQ_SNOWFLAKE_PASSWORD",
                  "SUPERQ_SNOWFLAKE_READ_ROLE",
                  "SUPERQ_SNOWFLAKE_WAREHOUSE",
                ]
              : [];
      const absent = secretNames.filter((k) => !process.env[k]);
      if (absent.length)
        add(
          t.id,
          "database",
          `Missing database credential references: ${absent.join(", ")}.`,
          "connections",
        );
      const variables = [
        ...JSON.stringify({
          input: s.input,
          assertions: s.assertions,
          web,
        }).matchAll(/\$\{([\w.-]+)\}/g),
      ].map((m) => m[1]!);
      const missing = [...new Set(variables.filter((k) => !available.has(k)))];
      if (missing.length)
        add(
          t.id,
          "data",
          `Step ${index + 1} needs configured data: ${missing.join(", ")}.`,
          "environments",
        );
      Object.keys(s.save).forEach((k) => available.add(k));
    }
    tests.push({
      id: t.id,
      title: t.title,
      dependency: !selection.roots.includes(t.id),
      status: issues.length > start ? "blocked" : "runnable",
    });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of tests)
      if (
        t.status === "runnable" &&
        p.tests
          .find((x) => x.id === t.id)!
          .dependsOn.some(
            (id) => tests.find((x) => x.id === id)?.status !== "runnable",
          )
      ) {
        t.status = "blocked";
        add(
          t.id,
          "dependency",
          "A prerequisite is blocked or will be skipped. Resolve it before this case can execute.",
          "tests",
        );
        changed = true;
      }
  }
  return {
    roots: selection.roots,
    tests,
    issues,
    warnings,
    canStart: !issues.some((i) => !i.testId || i.kind === "maintenance"),
    scope:
      "Configuration check only; no browser, application, model or cloud session was started. Runtime application behavior may still fail.",
  };
}
export type RunPreflight = Awaited<ReturnType<typeof runPreflight>>;
