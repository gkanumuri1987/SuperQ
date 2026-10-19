import {
  IntakePlan,
  Recipe,
  discover,
  preflight,
  reviewIntake,
  assertReviewed,
  materialize,
  assertPlanCurrent,
  proposeCase,
} from "./intake.js";
import {
  beginSignIn,
  authDirectory,
  sessionStatus,
  revokeSession,
} from "./auth-session.js";
import { createQuickTest } from "./quick-test.js";
import { TestDesign, designPairwise } from "./test-design.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { validateProject, type Project } from "./model.js";
import {
  compareProjects,
  stageChanges,
  type MaintenancePlan,
} from "./maintenance.js";
import {
  sampleProject,
  sampleCandidate,
  sampleApp,
} from "./workspace/sample.js";
import {
  canonical,
  reviewFingerprint,
  automationIdentity,
  projectFingerprint,
  isReviewCurrent,
} from "./identity.js";
import { coverage } from "./coverage.js";
import { audit } from "./audit.js";
import { run, resolveAccount } from "./runner.js";
import { createAdapters } from "./adapters.js";
import { createReport, writeReports, type Report } from "./reporting.js";
import { Planner } from "./ai.js";
import { ollamaProvider } from "./ollama.js";
import { snapshot, changes, type Snapshot } from "./knowledge.js";
import { Planning } from "./planning.js";
export type WorkspaceState = {
  intake?: IntakePlan;
  planning?: Planning;
  testDesign?: TestDesign;
  revision: number;
  sample: boolean;
  sampleVersion?: 1 | 2;
  project: Project;
  connections: {
    repository: string;
    tracker: string;
    documentation: string;
    localRepository: string;
    paths: string[];
    watch: boolean;
    lastChecked?: string;
    lastError?: string;
  };
  plan: MaintenancePlan | null;
  activities: { id: string; at: string; title: string; detail: string }[];
  runs: {
    id: string;
    state: "running" | "completed" | "failed";
    at: string;
    report?: Report;
    draftValidation?: boolean;
    error?: string;
  }[];
  history: { id: string; at: string; title: string; project: Project }[];
  sourceSnapshot?: Snapshot;
  sourceAlerts?: { path: string; revision: string }[];
};
export async function startWorkspace(
  options: {
    port?: number;
    file?: string;
    dev?: boolean;
    authDirectory?: string;
    authConnector?: Parameters<typeof beginSignIn>[4];
  } = {},
) {
  const port = options.port ?? 4310;
  const file = resolve(options.file ?? ".superq/workspace/state.json");
  const token = randomBytes(24).toString("hex");
  const sessionDirectory = options.authDirectory ?? authDirectory();
  let signInStarting = false;
  let signIn: {
    id: string;
    environment: string;
    user: string;
    handle: Awaited<ReturnType<typeof beginSignIn>>;
  } | null = null;
  const agentFile = join(dirname(file), "agent-connection.json");
  let agentAccess: { token: string; allowTrials: boolean } | null = null;
  let busy = false;
  let scanning = false;
  let state: WorkspaceState;
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as WorkspaceState;
    state = {
      ...raw,
      project: validateProject(raw.project),
      testDesign: raw.testDesign ? TestDesign.parse(raw.testDesign) : undefined,
      intake: raw.intake ? IntakePlan.parse(raw.intake) : undefined,
      planning: raw.planning ? Planning.parse(raw.planning) : undefined,
    };
    state.runs = state.runs.map((r) =>
      r.state === "running"
        ? {
            ...r,
            state: "failed",
            error: "Server restarted before the run completed",
          }
        : r,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(
        "Workspace state is invalid. Restore a known-good state file.",
      );
    const project = sampleProject(port);
    state = {
      revision: 1,
      sample: true,
      sampleVersion: 1,
      project,
      connections: {
        repository: "",
        tracker: "",
        documentation: "",
        localRepository: "",
        paths: [],
        watch: false,
      },
      plan: compareProjects(
        project,
        sampleCandidate(project),
        "Checkout confirmation updated",
        "sample",
      ),
      activities: [],
      runs: [],
      history: [],
    };
  }
  const activity = (title: string, detail: string) =>
    state.activities.unshift({
      id: randomUUID(),
      at: new Date().toISOString(),
      title,
      detail,
    });
  async function persist() {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, file);
  }
  let writing = Promise.resolve();
  function save() {
    writing = writing.catch(() => {}).then(persist);
    return writing;
  }
  function change(title: string, project: Project) {
    state.history.unshift({
      id: randomUUID(),
      at: new Date().toISOString(),
      title,
      project: state.project,
    });
    state.history = state.history.slice(0, 12);
    state.project = project;
    state.sourceAlerts = state.sourceAlerts?.filter(
      (c) => !project.evidence.some((e) => e.source === c.path),
    );
    state.revision++;
    activity(title, "Project changes saved in the local workspace.");
  }
  await save();
  let vite:
    Awaited<ReturnType<(typeof import("vite"))["createServer"]>> | undefined;
  if (options.dev) {
    const { createServer } = await import("vite");
    vite = await createServer({
      configFile: resolve("studio/vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
  }
  async function scan() {
    if (scanning) throw new Error("A source check is already running");
    scanning = true;
    try {
      if (!state.connections.localRepository || !state.connections.paths.length)
        throw new Error(
          "Configure a local repository and explicit source paths first",
        );
      if (busy)
        throw new Error("Wait for the active run to finish before scanning");
      const previous = state.sourceSnapshot;
      const next = await snapshot(
        state.connections.localRepository,
        state.connections.paths,
        !!previous,
      );
      state.connections.lastChecked = new Date().toISOString();
      delete state.connections.lastError;
      if (previous && changes(previous, next).length) {
        state.sourceAlerts = [
          ...new Map(
            [
              ...(state.sourceAlerts ?? []),
              ...changes(previous, next)
                .filter(
                  (c) =>
                    !state.project.evidence.some((e) => e.source === c.path),
                )
                .map((c) => ({ path: c.path, revision: next.revision })),
            ].map((c) => [c.path, c]),
          ).values(),
        ];
        if (state.plan?.items.some((i) => i.status === "pending"))
          throw new Error(
            "Resolve the current change review before scanning another revision",
          );
        const candidate = structuredClone(state.project);
        let matched = 0;
        for (const e of candidate.evidence) {
          const f = next.files.find((f) => f.path === e.source);
          if (
            previous.files.find((p) => p.path === e.source)?.hash !== f?.hash
          ) {
            e.revision = next.revision;
            e.excerpt = f
              ? f.content.slice(0, 12000)
              : "The tracked source was removed. Re-establish expected behavior before updating this test.";
            matched++;
          }
        }
        if (matched) {
          state.plan = compareProjects(
            state.project,
            candidate,
            `Application source changed · ${next.revision.slice(0, 7)}`,
            "source-scan",
          );
          const p = structuredClone(state.project);
          for (const item of state.plan.items) {
            const t = p.tests.find((t) => t.id === item.testId)!;
            t.status = "draft";
            delete t.review;
          }
          change("Source change needs review", validateProject(p));
          activity(
            "Source change detected",
            `${state.plan.items.length} tests require interpretation. No new expectations were invented.`,
          );
        } else
          activity(
            "Unmapped source changes",
            `${changes(previous, next).length} files changed. Map their paths to requirement evidence to determine test impact.`,
          );
      } else
        activity(
          previous ? "Source is up to date" : "Source baseline captured",
          `Read-only snapshot ${next.revision.slice(0, 7)} saved.`,
        );
      state.sourceSnapshot = next;
      state.revision++;
      await save();
    } finally {
      scanning = false;
    }
  }
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(value));
  };
  async function body(req: IncomingMessage) {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2_000_000) throw new Error("Request is too large");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  }
  async function launchRun(data: Record<string, unknown>, intakeTrial = false) {
    const input = z
      .object({
        environment: z.string(),
        user: z.string().min(1).optional(),
        suite: z.string(),
        profile: z.string(),
        workers: z.number().int().min(1).max(16),
        testIds: z.array(z.string()).default([]),
        validateDrafts: z.boolean().default(false),
        acknowledgeCloud: z.boolean().optional(),
      })
      .parse(data);
    const profile = state.project.browsers[input.profile];
    if (
      !Object.hasOwn(state.project.browsers, input.profile) ||
      !Object.hasOwn(state.project.environments, input.environment) ||
      !Object.hasOwn(state.project.suites, input.suite)
    )
      throw new Error("Unknown run configuration");
    if (
      profile!.provider !== "local" &&
      (!input.acknowledgeCloud || input.workers > profile!.maxSessions)
    )
      throw new Error(
        "Confirm cloud session costs and configured session limits",
      );
    const selected = new Set(
      input.testIds.length
        ? input.testIds
        : state.project.tests
            .filter((t) => t.suites.includes(input.suite))
            .map((t) => t.id),
    );
    let more = true;
    while (more) {
      more = false;
      for (const t of state.project.tests)
        if (selected.has(t.id))
          for (const dep of t.dependsOn)
            if (!selected.has(dep)) {
              selected.add(dep);
              more = true;
            }
    }
    if (
      state.plan?.items.some(
        (i) => i.status === "pending" && selected.has(i.testId),
      )
    )
      throw new Error(
        "Resolve maintenance changes for the selected tests and prerequisites before running",
      );
    if (
      state.intake?.generated?.testIds.some(
        (id) =>
          selected.has(id) &&
          (input.validateDrafts ||
            state.project.tests.find((t) => t.id === id)?.status === "draft"),
      )
    )
      assertReviewed(
        state.intake,
        state.project,
        state.planning,
        state.sourceSnapshot,
      );
    const project = validateProject(structuredClone(state.project));
    if (intakeTrial)
      Object.assign(project.execution, {
        includeTags: [],
        excludeTags: [],
        shard: undefined,
        retries: 0,
        maxFailures: 0,
        failOnFlaky: true,
      });
    project.execution.workers = input.workers;
    project.execution.user = input.user;
    project.execution.testIds = input.testIds;
    if (input.validateDrafts)
      for (const test of project.tests)
        if (selected.has(test.id) && test.status === "draft") {
          test.status = "approved";
          delete test.review;
        }
    const job: WorkspaceState["runs"][number] = {
      id: randomUUID(),
      state: "running",
      draftValidation: input.validateDrafts,
      at: new Date().toISOString(),
    };
    state.runs.unshift(job);
    busy = true;
    state.revision++;
    await save();

    void (async () => {
      const adapters = createAdapters(profile, undefined, sessionDirectory);
      try {
        const results = await run(
          project,
          input.environment,
          input.suite,
          adapters.registry,
        );
        job.report = createReport(
          project,
          input.environment,
          input.suite,
          [
            {
              profile: input.profile,
              provider: profile!.provider,
              browser: profile!.browser,
              results,
            },
          ],
          { ...automationIdentity(), startedAt: job.at },
        );
        await writeReports(
          job.report,
          ["json", "html", "junit", "markdown"],
          join(dirname(file), "runs", job.id),
        );
        job.state = "completed";
        activity(
          "Run completed",
          `${job.report.summary.passed}/${job.report.summary.total} tests passed.`,
        );
      } catch {
        job.state = "failed";
        job.error =
          "Run could not complete. Check browser installation, environment and adapter configuration.";
      } finally {
        await adapters.close().catch(() => {});
        busy = false;
        state.revision++;
        await save();
      }
    })();
    return job.id;
  }
  async function intakeBlockers() {
    const plan = state.intake;
    if (!plan) return [];
    const blockers = preflight(state.project, plan);
    const environment = state.project.environments[plan.environment];
    if (!blockers.length && environment?.sso) {
      const project = plan.generated
        ? state.project
        : materialize(state.project, plan);
      for (const c of plan.candidates.filter(
        (c) => c.selected && c.recipe?.kind === "web" && !c.anonymous,
      )) {
        const test = project.tests.find((t) => t.id === c.id)!;
        const account = resolveAccount(project, plan.environment, test);
        if (
          !account ||
          (await sessionStatus(
            project,
            plan.environment,
            account.id,
            sessionDirectory,
          )) !== "saved"
        )
          blockers.push({
            candidateId: c.id,
            kind: "authentication",
            detail: "A current scoped SSO/MFA session is required",
            resolution:
              "Choose a role/default environment account and complete sign-in in Environments & accounts.",
          });
      }
    }
    return blockers;
  }
  async function intakeContext() {
    let stale = false;
    if (state.intake)
      try {
        assertPlanCurrent(
          state.intake,
          state.project,
          state.planning,
          state.sourceSnapshot,
        );
      } catch {
        stale = true;
      }
    return {
      plan: state.intake ?? null,
      stale,
      blockers: state.intake && !stale ? await intakeBlockers() : [],
    };
  }
  function updateCandidate(data: Record<string, unknown>) {
    const plan = state.intake;
    if (!plan || plan.generated)
      throw new Error("Analyze a new plan before editing mappings");
    assertPlanCurrent(
      plan,
      state.project,
      state.planning,
      state.sourceSnapshot,
    );
    const candidate = plan.candidates.find((c) => c.id === data.candidateId);
    if (!candidate) throw new Error("Unknown candidate");
    const patch = z
      .object({
        selected: z.boolean().optional(),
        recipe: Recipe.nullable().optional(),
        role: z.string().optional(),
        user: z.string().optional(),
        anonymous: z.boolean().optional(),
      })
      .strict()
      .parse(data.patch);
    if (patch.selected !== undefined) candidate.selected = patch.selected;
    if (patch.recipe !== undefined)
      candidate.recipe = patch.recipe ?? undefined;
    if (patch.role !== undefined) candidate.role = patch.role || undefined;
    if (patch.user !== undefined) candidate.user = patch.user || undefined;
    if (patch.anonymous !== undefined) candidate.anonymous = patch.anonymous;
    delete plan.review;
    state.revision++;
  }
  async function generateIntake() {
    const plan = state.intake;
    if (!plan || plan.generated)
      throw new Error(
        "Analyze and review a plan first; generated drafts are reused",
      );
    assertReviewed(plan, state.project, state.planning, state.sourceSnapshot);
    if ((await intakeBlockers()).length)
      throw new Error("Resolve all preflight blockers before generating");
    change(
      "Reviewed intake automated as drafts",
      materialize(state.project, plan),
    );
    plan.generated = {
      testIds: plan.candidates.filter((c) => c.selected).map((c) => c.id),
      project: projectFingerprint(state.project),
    };
  }
  async function trialIntake() {
    const plan = state.intake;
    if (!plan?.generated)
      throw new Error("Generate reviewed draft automation first");
    assertReviewed(plan, state.project, state.planning, state.sourceSnapshot);
    if ((await intakeBlockers()).length)
      throw new Error(
        "Resolve current account, data and authentication blockers before the trial",
      );
    const local = Object.entries(state.project.browsers).find(
      ([, p]) => p.provider === "local",
    );
    if (!local)
      throw new Error("Configure a local browser profile for intake trials");
    return launchRun(
      {
        environment: plan.environment,
        suite: "intake",
        profile: local[0],
        workers: 1,
        testIds: plan.generated.testIds,
        validateDrafts: true,
      },
      true,
    );
  }
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      const host = req.headers.host ?? "";
      if (
        !new RegExp(
          `^(127\\.0\\.0\\.1|localhost):${(server.address() as { port: number })?.port}$`,
        ).test(host)
      ) {
        json(res, 403, { error: "Local workspace host required" });
        return;
      }
      if (path.startsWith("/sample-app")) {
        if (path.endsWith("/api/orders")) {
          const input = req.method === "POST" ? await body(req) : {};
          const valid = Array.isArray(input.items) && input.items.length > 0;
          json(
            res,
            valid ? 201 : 422,
            valid
              ? {
                  status: state.sampleVersion === 2 ? "placed" : "confirmed",
                  total: 120,
                }
              : { error: "Items required" },
          );
          return;
        }
        if (path.endsWith("/api/health")) {
          json(res, 200, { status: "ok" });
          return;
        }
        if (path.endsWith("/api/account")) {
          json(res, 401, { error: "Authentication required" });
          return;
        }
        if (path.endsWith("/api/inventory")) {
          json(res, 200, { available: true });
          return;
        }
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          state.sampleVersion === 2
            ? sampleApp
                .replaceAll("place-order", "submit-order")
                .replaceAll("Order confirmed", "Order placed")
            : sampleApp,
        );
        return;
      }
      if (path === "/api/agent") {
        if (
          req.method !== "POST" ||
          !agentAccess ||
          req.headers["x-superq-agent"] !== agentAccess.token ||
          req.headers["sec-fetch-site"] === "cross-site"
        ) {
          json(res, 403, {
            error: "Enable a dedicated coding-agent connection in Studio",
          });
          return;
        }
        const data = await body(req);
        if (data.action === "context") {
          json(res, 200, {
            revision: state.revision,
            project: state.project.name,
            environments: Object.fromEntries(
              Object.entries(state.project.environments).map(([name, e]) => [
                name,
                {
                  baseURL: e.baseURL,
                  apiURL: e.apiURL,
                  roles: Object.values(e.users ?? {}).map((u) => u.role),
                  accounts: Object.fromEntries(
                    Object.entries(e.users ?? {}).map(([alias, user]) => [
                      alias,
                      { role: user.role },
                    ]),
                  ),
                  dataKeys: Object.keys(e.data),
                },
              ]),
            ),
            catalog: state.project.catalog,
            locators: state.project.locators,
            requirements: state.project.requirements,
            evidence: state.project.evidence,
            inventory: state.planning,
            sources: state.sourceSnapshot
              ? {
                  revision: state.sourceSnapshot.revision,
                  files: state.sourceSnapshot.files.map((f) => ({
                    path: f.path,
                    hash: f.hash,
                    characters: f.content.length,
                  })),
                }
              : null,
            intake: await intakeContext(),
            runs: state.runs.slice(0, 5).map((r) => ({
              id: r.id,
              state: r.state,
              draftValidation: r.draftValidation,
              results: r.report?.results.slice(0, 100).map((result) => ({
                ...result,
                observations: result.observations?.slice(0, 100),
                diagnosticsTruncated:
                  result.diagnosticsTruncated ||
                  (result.observations?.length ?? 0) > 100,
              })),
              resultsTruncated: (r.report?.results.length ?? 0) > 100,
              error: r.error,
            })),
            permissions: {
              propose: true,
              approve: false,
              trials: agentAccess.allowTrials,
            },
          });
          return;
        }
        if (data.action === "source") {
          const file = state.sourceSnapshot?.files.find(
            (f) => f.path === data.path,
          );
          if (!file || data.sourceRevision !== state.sourceSnapshot?.revision)
            throw new Error(
              "Choose an explicitly scanned source path and its current source revision from context",
            );
          json(res, 200, { revision: state.sourceSnapshot!.revision, ...file });
          return;
        }
        if (data.revision !== state.revision) {
          json(res, 409, {
            error: "Workspace changed. Read context again before proposing.",
          });
          return;
        }
        if (busy || scanning || signInStarting || signIn)
          throw new Error("Wait for the active run, scan or sign-in to finish");
        if (data.action === "analyze") {
          state.intake = discover(
            state.project,
            z.string().parse(data.environment),
            z.enum(["api", "web"]).parse(data.preference),
            state.planning,
            state.sourceSnapshot,
          );
          state.revision++;
        } else if (data.action === "map") updateCandidate(data);
        else if (data.action === "propose-case") {
          if (!state.intake) throw new Error("Analyze sources first");
          proposeCase(
            state.intake,
            state.project,
            data.proposal,
            state.planning,
            state.sourceSnapshot,
          );
          state.revision++;
        } else if (data.action === "trial") {
          if (!agentAccess.allowTrials)
            throw new Error(
              "A human must enable reviewed local trials in Studio",
            );
          const id = await trialIntake();
          json(res, 202, { id });
          return;
        } else
          throw new Error(
            "Coding agents can read, analyze, propose mappings or run explicitly enabled reviewed trials. Approval and project edits require Studio.",
          );
        await save();
        json(res, 200, {
          revision: state.revision,
          intake: await intakeContext(),
        });
        return;
      }
      if (path === "/api/workspace" && req.method === "GET") {
        if (signIn?.handle.isClosed()) signIn = null;
        const authSessions: Record<string, Record<string, string>> = {};
        for (const [env, config] of Object.entries(state.project.environments))
          if (config.sso) {
            authSessions[env] = {};
            for (const user of Object.keys(config.users ?? {}))
              authSessions[env]![user] = await sessionStatus(
                state.project,
                env,
                user,
                sessionDirectory,
              );
          }

        json(res, 200, {
          ...state,
          token,
          intakeStatus: await intakeContext(),
          agentConnection: {
            enabled: !!agentAccess,
            allowTrials: agentAccess?.allowTrials ?? false,
            file: agentAccess ? agentFile : null,
          },
          authSessions,
          signIn: signIn
            ? {
                id: signIn.id,
                environment: signIn.environment,
                user: signIn.user,
              }
            : null,
          coverage: coverage(
            state.project,
            state.runs.find(
              (r) =>
                r.report &&
                !r.draftValidation &&
                r.report.provenance.projectFingerprint ===
                  projectFingerprint(state.project),
            )?.report?.runs[0]?.results ?? [],
          ),
          reviews: Object.fromEntries(
            state.project.tests.map((t) => [
              t.id,
              isReviewCurrent(state.project, t),
            ]),
          ),
          audit: audit(state.project),
        });
        return;
      }
      if (path.startsWith("/api/reports/") && req.method === "GET") {
        const id = path.split("/")[3];
        const format = path.split("/")[4];
        const r = state.runs.find((r) => r.id === id);
        if (
          !r?.report ||
          !["html", "json", "junit", "markdown"].includes(format ?? "")
        )
          throw new Error("Report not found");
        const name =
          format === "junit"
            ? "junit.xml"
            : `report.${format === "markdown" ? "md" : format}`;
        const data = await readFile(join(dirname(file), "runs", id!, name));
        res.writeHead(200, {
          "content-type":
            format === "html"
              ? "text/html"
              : format === "json"
                ? "application/json"
                : format === "junit"
                  ? "application/xml"
                  : "text/markdown",
          "content-security-policy":
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        });
        res.end(data);
        return;
      }
      if (path.startsWith("/api/")) {
        if (req.method !== "POST") {
          json(res, 405, { error: "Method not supported" });
          return;
        }
        if (
          req.headers["x-superq-token"] !== token ||
          req.headers["sec-fetch-site"] === "cross-site"
        ) {
          json(res, 403, { error: "Workspace request token required" });
          return;
        }
        const data = await body(req);
        if (data.revision !== state.revision) {
          json(res, 409, {
            error:
              "Workspace changed. Refresh before saving; your draft has not been applied.",
          });
          return;
        }
        if (signIn?.handle.isClosed()) signIn = null;
        if (
          (signInStarting || signIn) &&
          !["/api/auth/finish", "/api/auth/cancel"].includes(path)
        ) {
          json(res, 409, {
            error: "Finish or cancel the active SSO/MFA sign-in first.",
          });
          return;
        }
        if (busy && path !== "/api/ai") {
          json(res, 409, {
            error: "A run is active. Wait before changing the project.",
          });
          return;
        }
        if (path === "/api/intake/analyze") {
          state.intake = discover(
            state.project,
            z.string().parse(data.environment),
            z.enum(["api", "web"]).parse(data.preference),
            state.planning,
            state.sourceSnapshot,
          );
          state.revision++;
          activity(
            "Automation plan prepared",
            "Review source coverage, scope, dependencies and executable mappings before approving.",
          );
        } else if (path === "/api/intake/map") updateCandidate(data);
        else if (path === "/api/intake/propose-case") {
          if (!state.intake) throw new Error("Analyze sources first");
          proposeCase(
            state.intake,
            state.project,
            data.proposal,
            state.planning,
            state.sourceSnapshot,
          );
          state.revision++;
        } else if (path === "/api/intake/review") {
          if (!state.intake) throw new Error("Analyze sources first");
          if ((await intakeBlockers()).length)
            throw new Error("Resolve all selected plan blockers before review");
          reviewIntake(
            state.intake,
            state.project,
            z.string().parse(data.reviewer),
            state.planning,
            state.sourceSnapshot,
          );
          state.revision++;
          activity("Intake plan reviewed", state.intake.review!.reviewer);
        } else if (path === "/api/intake/generate") await generateIntake();
        else if (path === "/api/intake/trial") {
          json(res, 202, { id: await trialIntake() });
          return;
        } else if (path === "/api/agent-access") {
          const enabled = z.boolean().parse(data.enabled);
          if (enabled) {
            agentAccess = {
              token: randomBytes(32).toString("hex"),
              allowTrials: z.boolean().parse(data.allowTrials),
            };
            const temp = `${agentFile}.tmp`;
            await writeFile(
              temp,
              JSON.stringify({
                url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
                token: agentAccess.token,
              }),
              { mode: 0o600 },
            );
            await rename(temp, agentFile);
          } else {
            agentAccess = null;
            await rm(agentFile, { force: true });
          }
          state.revision++;
          activity(
            "Coding-agent access changed",
            enabled
              ? "Explicit local connection enabled; plan approval remains in Studio."
              : "Agent connection revoked.",
          );
        } else if (path === "/api/auth/start") {
          if (
            canonical(data.base) !==
            canonical({
              roles: state.project.roles ?? {},
              environments: state.project.environments,
            })
          ) {
            json(res, 409, {
              error: "Save or reload environment setup before signing in.",
            });
            return;
          }
          signInStarting = true;
          try {
            const environment = z.string().parse(data.environment),
              user = z.string().parse(data.user);
            const handle = await beginSignIn(
              state.project,
              environment,
              user,
              sessionDirectory,
              options.authConnector,
            );
            signIn = { id: randomUUID(), environment, user, handle };
          } finally {
            signInStarting = false;
          }
          json(res, 200, { ok: true });
          return;
        } else if (path === "/api/auth/finish") {
          if (!signIn || data.id !== signIn.id)
            throw new Error("No matching sign-in is active.");
          await signIn.handle.finish();
          signIn = null;
          json(res, 200, { ok: true });
          return;
        } else if (path === "/api/auth/cancel") {
          if (signIn && data.id !== signIn.id)
            throw new Error("No matching sign-in is active.");
          await signIn?.handle.cancel();
          signIn = null;
          json(res, 200, { ok: true });
          return;
        } else if (path === "/api/auth/revoke") {
          await revokeSession(
            state.project,
            z.string().parse(data.environment),
            z.string().parse(data.user),
            sessionDirectory,
          );
          json(res, 200, { ok: true });
          return;
        } else if (path === "/api/environments") {
          const current = {
            roles: state.project.roles ?? {},
            environments: state.project.environments,
          };
          if (canonical(data.base) !== canonical(current)) {
            json(res, 409, {
              error: "Environment setup changed. Reload before saving.",
            });
            return;
          }
          const project = validateProject({
            ...state.project,
            roles: data.roles,
            environments: data.environments,
          });
          change("Environments and test accounts updated", project);
        } else if (path === "/api/quick-test") {
          change(
            "Functional test created",
            createQuickTest(state.project, data.test),
          );
        } else if (path === "/api/test-design") {
          const baseDesign =
            data.baseDesign === null ? null : TestDesign.parse(data.baseDesign);
          if (
            JSON.stringify(baseDesign) !==
            JSON.stringify(state.testDesign ?? null)
          ) {
            json(res, 409, {
              error:
                "This coverage design changed in another session. Reload before saving; your changes have not been applied.",
            });
            return;
          }
          const design = TestDesign.parse(data.design);
          designPairwise(design);
          state.testDesign = design;
          state.revision++;
          activity(
            "Coverage design saved",
            "Pairwise data model saved for QE review",
          );
        } else if (path === "/api/planning") {
          state.planning = Planning.parse(data.planning);
          state.revision++;
          activity(
            "Sprint intake updated",
            "Manual cases and evidence saved for review",
          );
        } else if (path === "/api/project")
          change("Project updated", validateProject(data.project));
        else if (path === "/api/import") {
          change("Project imported", validateProject(data.project));
          state.intake = undefined;
          state.planning = undefined;
          state.testDesign = undefined;
          state.sample = false;
          state.plan = null;
          state.sourceSnapshot = undefined;
          state.sourceAlerts = [];
          state.connections.watch = false;
        } else if (path === "/api/setup") {
          const input = z
            .object({
              name: z.string().min(1),
              baseURL: z.url(),
              repository: z.string(),
              tracker: z.string(),
              documentation: z.string(),
              localRepository: z.string(),
              paths: z.array(z.string()),
              watch: z.boolean(),
            })
            .parse(data);
          const p = structuredClone(state.project);
          p.name = input.name;
          const env = Object.keys(p.environments)[0]!;
          p.environments[env]!.baseURL = input.baseURL;
          change("Workspace setup updated", validateProject(p));
          state.connections = { ...state.connections, ...input };
          state.sourceSnapshot = undefined;
          state.plan = null;
          state.sourceAlerts = [];
        } else if (path === "/api/compare") {
          if (
            state.plan?.items.some((i) => i.status === "pending") &&
            data.replace !== true
          )
            throw new Error(
              "Resolve the current comparison or explicitly replace it",
            );
          state.plan = compareProjects(
            state.project,
            data.candidate,
            String(data.title ?? "Application update"),
            "comparison",
          );
          state.revision++;
          activity("Change comparison ready", state.plan.summary);
        } else if (path === "/api/sample-change") {
          if (!state.sample)
            throw new Error(
              "Sample changes are available only for the sample workspace",
            );
          state.plan = compareProjects(
            state.project,
            sampleCandidate(state.project),
            "Checkout confirmation updated",
            "sample",
          );
          state.revision++;
        } else if (path === "/api/sample-version") {
          if (!state.sample) throw new Error("Sample app only");
          state.sampleVersion = z
            .union([z.literal(1), z.literal(2)])
            .parse(data.version);
          state.revision++;
          activity(
            "Sample app version changed",
            `The built-in sample now serves version ${state.sampleVersion}. This does not deploy any external application.`,
          );
        } else if (path === "/api/stage") {
          if (!state.plan) throw new Error("No comparison to review");
          const ids = z.array(z.string()).parse(data.ids);
          const preserve = data.mode === "keep-current";
          const note = preserve
            ? z.string().trim().min(8).parse(data.note)
            : "";
          const next = stageChanges(state.project, state.plan, ids, preserve);
          change(
            preserve
              ? "Manually resolved maintenance update"
              : "Maintenance updates staged as drafts",
            next,
          );
          for (const i of state.plan.items)
            if (ids.includes(i.id)) {
              i.status = "staged";
              if (preserve) i.resolution = note;
            }
          state.plan.sourceStaged = true;
        } else if (path === "/api/restore") {
          const version = state.history.find((h) => h.id === data.id);
          if (!version) throw new Error("History version not found");
          const candidate = state.plan?.candidate;
          change(
            "Previous project version restored",
            validateProject(version.project),
          );
          state.plan =
            candidate && candidate.name === state.project.name
              ? compareProjects(
                  state.project,
                  candidate,
                  "Recheck changes after restore",
                )
              : null;
        } else if (path === "/api/approve") {
          const id = z.string().parse(data.testId),
            reviewer = z.string().trim().min(1).parse(data.reviewer);
          if (
            state.plan?.items.some(
              (i) => i.testId === id && i.status === "pending",
            )
          )
            throw new Error(
              "Review and stage the pending source change before approving this test",
            );
          const p = structuredClone(state.project),
            test = p.tests.find((t) => t.id === id);
          if (
            !test ||
            !test.steps.length ||
            !test.steps.some((s) => s.assertions.length) ||
            test.blockedBy.length
          )
            throw new Error(
              "Resolve blockers and add asserted automation first",
            );
          test.status = "approved";
          test.review = {
            reviewer,
            at: new Date().toISOString(),
            digest: reviewFingerprint(p, test),
          };
          change("Test review recorded", validateProject(p));
        } else if (path === "/api/scan") {
          await scan();
          json(res, 200, { ok: true });
          return;
        } else if (path === "/api/ai") {
          const model = z.string().min(1).parse(data.model),
            requirement = z.string().parse(data.requirement);
          const result = await new Planner(ollamaProvider(model), 0.01).propose(
            state.project,
            requirement,
            0.01,
          );
          json(res, 200, { proposal: result, status: "draft" });
          return;
        } else if (path === "/api/runs") {
          json(res, 202, { id: await launchRun(data) });
          return;
        } else {
          json(res, 404, { error: "Unknown workspace action" });
          return;
        }
        await save();
        json(res, 200, { ok: true });
        return;
      }
      if (vite) {
        vite.middlewares(req, res, () => {
          res.writeHead(404);
          res.end();
        });
        return;
      }
      const root = resolve("studio-dist");
      const target = resolve(root, "." + (path === "/" ? "/index.html" : path));
      if (!target.startsWith(root + "/")) throw new Error("Invalid path");
      const asset = await readFile(target).catch(() =>
        readFile(join(root, "index.html")),
      );
      res.writeHead(200, {
        "content-type":
          (
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
            } as Record<string, string>
          )[extname(target)] ?? "text/html",
        "x-content-type-options": "nosniff",
      });
      res.end(asset);
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? "Some fields are invalid. Check IDs, URLs, mappings and required values."
          : error instanceof SyntaxError
            ? "Invalid JSON. Check the editor or imported file."
            : error instanceof Error
              ? error.message
              : "Workspace action failed";
      json(res, 400, { error: message });
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  if (state.sample && state.project.environments.sample) {
    const baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}/sample-app/`;
    state.project.environments.sample.baseURL = baseURL;
    if (state.plan) {
      state.plan.baseline.environments.sample!.baseURL = baseURL;
      state.plan.candidate.environments.sample!.baseURL = baseURL;
    }
    await save();
  }
  const timer = setInterval(() => {
    if (
      state.connections.watch &&
      !busy &&
      !scanning &&
      !signIn &&
      !signInStarting
    )
      void scan().catch(async () => {
        state.connections.lastError =
          "Source scan failed or a comparison needs review. Check the configured paths and inbox.";
        await save();
      });
  }, 30000);
  timer.unref();
  return {
    server,
    state: () => state,
    close: async () => {
      clearInterval(timer);
      agentAccess = null;
      await rm(agentFile, { force: true });
      await signIn?.handle.cancel();
      await vite?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await startWorkspace({
    dev: process.argv.includes("--dev"),
    port: Number(process.env.SUPERQ_PORT ?? 4310),
  });
  console.log(`SuperQ Studio: ${app.url}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void app.close().then(() => process.exit());
    });
}
