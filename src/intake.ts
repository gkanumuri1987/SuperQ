import { createHash } from "node:crypto";
import { z } from "zod";
import { Assertion, validateProject, type Project } from "./model.js";
import { canonical, projectFingerprint } from "./identity.js";
import { type Planning } from "./planning.js";
import type { Snapshot } from "./knowledge.js";
import { resolveAccount, resolveData } from "./runner.js";

const locator = z
  .object({
    strategy: z.enum(["role", "label", "text", "testId"]),
    value: z.string().min(1),
    name: z.string().optional(),
  })
  .strict();
const relativePath = z
  .string()
  .min(1)
  .refine((p) => {
    try {
      const u = new URL(p, "http://superq.invalid/");
      return (
        u.origin === "http://superq.invalid" &&
        !u.username &&
        !u.password &&
        !/^[a-z]+:/i.test(p)
      );
    } catch {
      return false;
    }
  }, "Use an application-relative path");
export const Recipe = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("api"),
      requests: z
        .array(
          z
            .object({
              path: relativePath,
              method: z
                .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
                .default("GET"),
              body: z.unknown().optional(),
              assertions: z.array(Assertion).min(1),
            })
            .strict(),
        )
        .min(1)
        .max(50),
    })
    .strict(),
  z
    .object({
      kind: z.literal("web"),
      commands: z
        .array(
          z.discriminatedUnion("type", [
            z.object({ type: z.literal("goto"), path: relativePath }).strict(),
            z.object({ type: z.literal("click"), locator }).strict(),
            z
              .object({ type: z.literal("fill"), locator, value: z.string() })
              .strict(),
            z
              .object({
                type: z.literal("expectText"),
                locator,
                value: z.string().min(1),
              })
              .strict(),
          ]),
        )
        .min(1)
        .max(100),
    })
    .strict()
    .refine(
      (r) =>
        r.commands[0]?.type === "goto" &&
        r.commands.some((c) => c.type === "expectText"),
      "A web flow needs initial navigation and an explicit expected text assertion",
    ),
]);
export type Recipe = z.infer<typeof Recipe>;
const Ref = z.object({
  source: z.string(),
  revision: z.string(),
  excerpt: z.string().min(1),
});
export const IntakePlan = z.object({
  id: z.string(),
  createdAt: z.string(),
  mode: z.enum(["repository", "inventory", "combined"]),
  environment: z.string(),
  preference: z.enum(["api", "web"]),
  context: z.object({ project: z.string(), sources: z.string() }),
  candidates: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      origin: z.enum(["qe", "ai"]).default("ai"),
      evidence: z.array(Ref).min(1),
      steps: z.array(z.object({ action: z.string(), expected: z.string() })),
      dependsOn: z.array(z.string()),
      disposition: z.enum([
        "current",
        "out-of-scope",
        "deprecated-review",
        "obsolete-candidate",
        "needs-context",
      ]),
      selected: z.boolean(),
      questions: z.array(z.string()),
      existingTestIds: z.array(z.string()),
      recipe: Recipe.optional(),
      role: z.string().optional(),
      user: z.string().optional(),
      anonymous: z.boolean().optional(),
    }),
  ),
  questions: z.array(z.string()),
  review: z
    .object({ reviewer: z.string(), at: z.string(), digest: z.string() })
    .optional(),
  generated: z
    .object({ testIds: z.array(z.string()), project: z.string() })
    .optional(),
});
export type IntakePlan = z.infer<typeof IntakePlan>;
export type Candidate = IntakePlan["candidates"][number];
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const key = (value: string) => hash(value).slice(0, 16);
export const intakeSources = (planning?: Planning, snapshot?: Snapshot) =>
  hash({ planning, snapshot });
export function planDigest(plan: IntakePlan) {
  const { review: _, generated: __, ...content } = plan;
  return hash(content);
}
export function assertPlanCurrent(
  plan: IntakePlan,
  project: Project,
  planning?: Planning,
  snapshot?: Snapshot,
) {
  if (
    plan.context.sources !== intakeSources(planning, snapshot) ||
    (plan.generated?.project ?? plan.context.project) !==
      projectFingerprint(project)
  )
    throw new Error(
      "Application knowledge, tests or environment changed. Analyze again and review a fresh plan.",
    );
}
export function discover(
  project: Project,
  environment: string,
  preference: "api" | "web",
  planning?: Planning,
  snapshot?: Snapshot,
): IntakePlan {
  if (!Object.hasOwn(project.environments, environment))
    throw new Error("Choose a configured environment");
  const repo = Boolean(snapshot?.files.length),
    inventory = Boolean(planning?.cases.length);
  if (!repo && !inventory)
    throw new Error(
      "Scan committed repository sources or import manual test inventory first. A repository URL alone is not application knowledge.",
    );
  const candidates: Candidate[] = [],
    questions: string[] = [];
  const add = (
    identity: string,
    title: string,
    evidence: Candidate["evidence"],
    steps: Candidate["steps"],
    extra: Partial<Candidate> = {},
  ) => {
    const existingTestIds = project.tests
      .filter(
        (t) =>
          t.title.trim().toLowerCase() === title.trim().toLowerCase() ||
          t.evidenceIds.some((id) =>
            project.evidence.some(
              (e) =>
                e.id === id &&
                evidence.some(
                  (ref) => ref.source === e.source && ref.excerpt === e.excerpt,
                ),
            ),
          ),
      )
      .map((t) => t.id);
    candidates.push({
      id: `SQ-I-${key(identity)}`,
      origin: "ai",
      title,
      evidence,
      steps,
      dependsOn: [],
      disposition: "current",
      selected: existingTestIds.length === 0,
      questions: [],
      existingTestIds,
      ...extra,
    });
  };
  if (planning) {
    for (const c of planning.cases) {
      // Scope and lifecycle are supplied by tracker context, never inferred from age.
      const retired = c.featureIds.some(
        (id) =>
          planning.features.find((f) => f.id === id)?.lifecycle === "retired",
      );
      const deprecated = c.featureIds.some(
        (id) =>
          planning.features.find((f) => f.id === id)?.lifecycle ===
          "deprecated",
      );
      const known =
        c.featureIds.length > 0 &&
        c.featureIds.every((id) => planning.features.some((f) => f.id === id));
      const inSprint =
        !planning.stories.length ||
        planning.stories.some(
          (s) =>
            c.storyIds.includes(s.id) ||
            s.featureIds.some((f) => c.featureIds.includes(f)),
        );
      const disposition = retired
        ? "obsolete-candidate"
        : deprecated
          ? "deprecated-review"
          : !known
            ? "needs-context"
            : !inSprint
              ? "out-of-scope"
              : "current";
      add(
        `${c.source}:${c.externalId}`,
        c.title,
        [
          {
            source: `${c.source}#${c.externalId}`,
            revision: c.revision,
            excerpt: JSON.stringify(c.steps),
          },
        ],
        c.steps,
        {
          disposition,
          origin: "qe",
          selected:
            disposition === "current" &&
            !project.tests.some(
              (t) =>
                t.id === `SQ-I-${key(`${c.source}:${c.externalId}`)}` ||
                t.title.trim().toLowerCase() === c.title.trim().toLowerCase(),
            ),
          dependsOn: c.dependsOn.map((d) => `SQ-I-${key(d)}`),
          questions: !known
            ? [
                "Confirm feature scope and lifecycle before selecting this case.",
              ]
            : [],
        },
      );
    }
    for (const s of planning.stories)
      for (const criterion of s.criteria) {
        const linked = planning.cases.filter((c) => c.storyIds.includes(s.id));
        if (
          !linked.some((c) =>
            c.steps.some(
              (step) =>
                step.expected.trim().toLowerCase() ===
                criterion.trim().toLowerCase(),
            ),
          )
        )
          add(
            `story:${s.id}:${criterion}`,
            `${s.title}: ${criterion}`,
            [s.evidence],
            [
              {
                action: "Define a reproducible action for this criterion",
                expected: criterion,
              },
            ],
            {
              questions: [
                "No exact expected-result match in linked manual tests. Review semantic overlap, positive/negative partitions, boundaries and integration failures.",
              ],
            },
          );
      }
  }
  for (const f of snapshot?.files ?? []) {
    const ref = { source: f.path, revision: snapshot!.revision, excerpt: "" };
    if (/\.feature$/i.test(f.path)) {
      const scenarios = f.content
        .split(/^\s*Scenario(?: Outline)?:\s*/m)
        .slice(1);
      for (const s of scenarios) {
        const title = s.split(/\r?\n/)[0]!.trim();
        const steps = s
          .split(/\r?\n/)
          .slice(1)
          .filter((line) => /^\s*(Given|When|Then|And|But)\s+/.test(line))
          .map((line) => ({
            action: line.trim(),
            expected: /^\s*Then\s+/.test(line)
              ? line.trim().replace(/^Then\s+/, "")
              : "Review expected result",
          }));
        if (steps.length)
          add(
            `${f.path}:${title}`,
            title,
            [{ ...ref, excerpt: s.trim() }],
            steps,
            {
              questions: [
                "Map Gherkin steps and example rows to executable actions and independent expected results.",
              ],
            },
          );
      }
    } else if (/\.json$/i.test(f.path)) {
      let doc;
      try {
        doc = JSON.parse(f.content);
      } catch {
        continue;
      }
      if (!doc.openapi || !doc.paths || typeof doc.paths !== "object") continue;
      for (const [path, raw] of Object.entries(doc.paths)) {
        if (!raw || typeof raw !== "object") continue;
        for (const [method, operation] of Object.entries(raw)) {
          if (
            !["get", "post", "put", "patch", "delete", "head"].includes(
              method,
            ) ||
            !operation ||
            typeof operation !== "object"
          )
            continue;
          const op = operation as Record<string, any>;
          for (const [status, response] of Object.entries(op.responses ?? {})) {
            if (
              !/^\d{3}$/.test(status) ||
              !response ||
              typeof response !== "object"
            )
              continue;
            const content = (response as any).content?.["application/json"];
            const example = content?.example;
            const primitive =
              example && typeof example === "object" && !Array.isArray(example)
                ? Object.entries(example).find(
                    ([name, value]) =>
                      /^[a-zA-Z][\w-]*$/.test(name) &&
                      ["string", "number", "boolean"].includes(typeof value),
                  )
                : undefined;
            const blocked =
              /[{}]/.test(path) ||
              (op.parameters?.length ?? 0) > 0 ||
              ((raw as Record<string, any>).parameters?.length ?? 0) > 0 ||
              Boolean(op.requestBody) ||
              Boolean(op.security?.length ?? doc.security?.length);
            const recipe: Recipe | undefined =
              preference === "api" && primitive && !blocked
                ? {
                    kind: "api",
                    requests: [
                      {
                        path,
                        method: method.toUpperCase() as "GET",
                        assertions: [
                          {
                            path: "status",
                            operator: "equals",
                            expected: Number(status),
                          },
                          {
                            path: `body.${primitive[0]}`,
                            operator: "equals",
                            expected: primitive[1],
                          },
                        ],
                      },
                    ],
                  }
                : undefined;
            add(
              `${f.path}:${method}:${path}:${status}`,
              `${method.toUpperCase()} ${path} → ${status}`,
              [
                {
                  ...ref,
                  excerpt: JSON.stringify({
                    path,
                    method,
                    response,
                    security: op.security ?? doc.security,
                  }),
                },
              ],
              [
                {
                  action: `${method.toUpperCase()} ${path}`,
                  expected: `HTTP ${status}: ${(response as any).description ?? "Review response contract"}`,
                },
              ],
              {
                recipe,
                questions: [
                  "OpenAPI examples are candidate oracles. Confirm business correctness, security, data setup and positive/negative coverage.",
                  ...(blocked
                    ? [
                        "Resolve parameters, request data and authentication before mapping automation.",
                      ]
                    : []),
                ],
              },
            );
          }
        }
      }
    }
  }
  if (repo)
    questions.push(
      "Only explicitly scanned committed files were analyzed. Arbitrary source code, external integrations and runtime behavior require additional evidence; code is not an independent business oracle.",
    );
  if (!inventory)
    questions.push(
      "No manual inventory: review generated scenarios with a QE before automation.",
    );
  if (!repo)
    questions.push(
      "No repository: feature completeness, changed code and obsolete behavior cannot be confirmed from tests alone.",
    );
  if (!candidates.length)
    questions.push(
      "No supported scenario or OpenAPI response found. Import manual tests, .feature specifications or OpenAPI JSON; a coding agent can help map the evidence, but must not invent expectations.",
    );
  for (const candidate of candidates) {
    if (
      project.tests.some((t) => t.id === candidate.id) &&
      !candidate.existingTestIds.includes(candidate.id)
    )
      candidate.existingTestIds.push(candidate.id);
    if (candidate.existingTestIds.length) candidate.selected = false;
    const same = candidates.find(
      (c) =>
        c !== candidate &&
        candidates.indexOf(c) < candidates.indexOf(candidate) &&
        c.title.trim().toLowerCase() === candidate.title.trim().toLowerCase(),
    );
    if (same) {
      candidate.selected = false;
      candidate.questions.push(
        `Possible duplicate of ${same.id}; reconcile evidence and expected results before selecting both.`,
      );
    }
  }
  if (candidates.length > 500)
    throw new Error(
      "Limit intake to 500 candidates per plan; split the source inventory.",
    );
  return IntakePlan.parse({
    id: `intake-${Date.now()}-${key(candidates.map((c) => c.id).join())}`,
    createdAt: new Date().toISOString(),
    mode: repo && inventory ? "combined" : repo ? "repository" : "inventory",
    environment,
    preference,
    context: {
      project: projectFingerprint(project),
      sources: intakeSources(planning, snapshot),
    },
    candidates,
    questions,
  });
}

export function materialize(project: Project, plan: IntakePlan): Project {
  let p = structuredClone(project);
  const selected = plan.candidates.filter((c) => c.selected);
  if (!selected.length) throw new Error("Select at least one test to automate");
  p.suites.intake ??= { data: {} };
  const addLocator = (definition: z.infer<typeof locator>) => {
    const found = Object.entries(p.locators).find(
      ([, l]) => canonical(l) === canonical(definition),
    );
    if (found) return found[0];
    const id = `intake-${key(canonical(definition))}`;
    if (p.locators[id]) throw new Error("Locator ID collision");
    p.locators[id] = definition;
    return id;
  };
  for (const c of selected) {
    if (c.disposition !== "current")
      throw new Error(
        `${c.title}: resolve scope or lifecycle before automation`,
      );
    if (c.existingTestIds.length)
      throw new Error(
        `${c.title}: existing automation found; review it in the test library instead of duplicating work`,
      );
    if (!c.recipe || c.recipe.kind !== plan.preference)
      throw new Error(
        `${c.title}: map ${plan.preference} steps and expected assertions first`,
      );
    if (p.tests.some((t) => t.id === c.id))
      throw new Error(
        `${c.title}: already generated; reuse the existing draft`,
      );
    const req = `REQ-${c.id}`,
      evidenceIds = c.evidence.map((e, n) => {
        const id = `EV-${c.id}-${n}`;
        p.evidence.push({ id, ...e });
        return id;
      });
    if (
      p.requirements.some((r) => r.id === req) ||
      evidenceIds.some((id) => p.evidence.filter((e) => e.id === id).length > 1)
    )
      throw new Error("Intake evidence or requirement ID collision");
    p.requirements.push({
      id: req,
      title: c.title,
      risk: "medium",
      criteria: [
        { id: "expected", title: c.steps.map((s) => s.expected).join("; ") },
      ],
      evidenceIds,
    });
    const operation = c.recipe.kind === "api" ? "request" : "journey";
    let action = p.catalog.find(
      (a) => a.kind === c.recipe!.kind && a.operation === operation,
    );
    if (!action) {
      action = {
        id: `intake.${operation}`,
        kind: c.recipe.kind,
        operation,
        description: "Reviewed intake automation",
      };
      if (p.catalog.some((a) => a.id === action!.id))
        throw new Error("Catalog ID collision");
      p.catalog.push(action);
    }
    const steps: Project["tests"][number]["steps"] = [];
    if (c.recipe.kind === "api")
      for (const r of c.recipe.requests)
        steps.push({
          action: action.id,
          input: {
            path: r.path,
            method: r.method,
            ...(r.body !== undefined ? { body: r.body } : {}),
          },
          assertions: r.assertions,
          save: {},
        });
    else {
      const assertions: z.infer<typeof Assertion>[] = [];
      const commands = c.recipe.commands.map((command, index) => {
        if (command.type === "goto") return command;
        const id = addLocator(command.locator);
        if (command.type === "expectText")
          assertions.push({
            path: `checkpoints.${index + 1}`,
            operator: "equals",
            expected: command.value,
          });
        return { ...command, locator: id };
      });
      steps.push({
        action: action.id,
        input: { commands },
        assertions,
        save: {},
      });
    }
    p.tests.push({
      id: c.id,
      title: c.title,
      role: c.role,
      user: c.user,
      anonymous: c.anonymous,
      origin: c.origin,
      status: "draft",
      requirementIds: [req],
      covers: { [req]: ["expected"] },
      evidenceIds,
      suites: ["intake"],
      tags: ["intake", plan.preference],
      dependsOn: c.dependsOn,
      blockedBy: [],
      retrySafe: false,
      data: {},
      steps,
    });
  }
  p = validateProject(p);
  return p;
}
export function preflight(project: Project, plan: IntakePlan) {
  const blockers: {
    candidateId: string;
    kind: string;
    detail: string;
    resolution: string;
  }[] = [];
  for (const c of plan.candidates.filter((c) => c.selected)) {
    const block = (kind: string, detail: string, resolution: string) =>
      blockers.push({ candidateId: c.id, kind, detail, resolution });
    if (c.disposition !== "current")
      block(
        "scope",
        c.disposition,
        "Confirm scope/lifecycle and analyze the updated inventory again.",
      );
    if (c.existingTestIds.length)
      block(
        "duplicate",
        `Existing tests: ${c.existingTestIds.join(", ")}`,
        "Deselect this proposal and maintain the existing automation.",
      );
    if (!c.recipe || c.recipe.kind !== plan.preference) {
      block(
        "mapping",
        "Executable actions and expected results are not mapped",
        `Map a ${plan.preference} flow with explicit assertions.`,
      );
      continue;
    }
    for (const dep of c.dependsOn)
      if (
        !plan.candidates.some((d) => d.id === dep && d.selected) &&
        !project.tests.some((t) => t.id === dep)
      )
        block(
          "dependency",
          `Missing prerequisite ${dep}`,
          "Include and map the prerequisite or correct the inventory dependency.",
        );
  }
  if (!plan.candidates.some((c) => c.selected))
    blockers.push({
      candidateId: "plan",
      kind: "selection",
      detail: "No tests selected",
      resolution: "Select current tests for this plan.",
    });
  const mapped = plan.candidates.filter((c) => c.selected && c.recipe);
  for (const c of mapped) {
    const duplicate = mapped.find(
      (other) =>
        other !== c &&
        mapped.indexOf(other) < mapped.indexOf(c) &&
        canonical({
          recipe: other.recipe,
          role: other.role,
          user: other.user,
          anonymous: other.anonymous,
        }) ===
          canonical({
            recipe: c.recipe,
            role: c.role,
            user: c.user,
            anonymous: c.anonymous,
          }),
    );
    if (duplicate)
      blockers.push({
        candidateId: c.id,
        kind: "duplicate",
        detail: `Identical automation is already proposed by ${duplicate.id}`,
        resolution:
          "Reuse one test and review its requirement links instead of generating duplicate work.",
      });
  }
  if (blockers.length) return blockers;
  try {
    const p = plan.generated ? project : materialize(project, plan);
    for (const c of plan.candidates.filter((c) => c.selected)) {
      const t = p.tests.find((t) => t.id === c.id)!;
      try {
        const account = resolveAccount(p, plan.environment, t);
        const environment = p.environments[plan.environment]!;
        if (
          c.recipe?.kind === "web" &&
          !c.anonymous &&
          (environment.login || environment.sso) &&
          !account
        )
          throw new Error("Authentication account required");
        const data = {
          ...resolveData(p, plan.environment, "intake", t.data),
          ...p.environments[plan.environment]?.testData?.[t.id],
          "url.web": p.environments[plan.environment]?.baseURL,
          "url.api":
            p.environments[plan.environment]?.apiURL ??
            p.environments[plan.environment]?.baseURL,
          ...Object.fromEntries(
            Object.entries(p.environments[plan.environment]?.urls ?? {}).map(
              ([k, v]) => [`url.${k}`, v],
            ),
          ),
          ...(account
            ? {
                "user.id": account.id,
                "user.role": account.role,
                "user.username": account.username,
                "user.password": account.password,
                "user.token": account.token,
              }
            : {}),
        };
        const variables = [
          ...canonical(c.recipe).matchAll(/\$\{([^}]+)\}/g),
        ].map((m) => m[1]!);
        const missing = [
          ...new Set(
            variables.filter(
              (v) =>
                ![
                  "superq.testId",
                  "superq.attempt",
                  "superq.runId",
                  "superq.environment",
                  "superq.suite",
                ].includes(v) &&
                (data as Record<string, unknown>)[v] === undefined,
            ),
          ),
        ];
        if (missing.length)
          blockers.push({
            candidateId: c.id,
            kind: "data",
            detail: `Missing variables: ${missing.join(", ")}`,
            resolution:
              "Configure environment/suite/test data or account secret references; do not paste secrets into the plan.",
          });
      } catch {
        blockers.push({
          candidateId: c.id,
          kind: "account",
          detail: "Role, account or referenced secret is unavailable",
          resolution:
            "Configure an environment account for the required role and available secret references.",
        });
      }
    }
  } catch (error) {
    blockers.push({
      candidateId: "plan",
      kind: "dependency",
      detail: (error as Error).message,
      resolution:
        "Correct dependency cycles, mappings or project references before review.",
    });
  }
  return blockers;
}
export function reviewIntake(
  plan: IntakePlan,
  project: Project,
  reviewer: string,
  planning?: Planning,
  snapshot?: Snapshot,
) {
  assertPlanCurrent(plan, project, planning, snapshot);
  if (plan.generated)
    throw new Error(
      "Plan already generated; review its drafts in the test library",
    );
  if (preflight(project, plan).length)
    throw new Error("Resolve all selected plan blockers before review");
  plan.review = {
    reviewer: z.string().trim().min(1).parse(reviewer),
    at: new Date().toISOString(),
    digest: planDigest(plan),
  };
}
export function assertReviewed(
  plan: IntakePlan,
  project: Project,
  planning?: Planning,
  snapshot?: Snapshot,
) {
  assertPlanCurrent(plan, project, planning, snapshot);
  if (!plan.review || plan.review.digest !== planDigest(plan))
    throw new Error(
      "A human must review the current automation plan in Studio first",
    );
}

export const CaseProposal = z
  .object({
    title: z.string().trim().min(1).max(300),
    steps: z
      .array(
        z
          .object({ action: z.string().min(1), expected: z.string().min(1) })
          .strict(),
      )
      .min(1)
      .max(100),
    evidence: z.array(Ref).min(1).max(20),
    recipe: Recipe.optional(),
  })
  .strict();
export function proposeCase(
  plan: IntakePlan,
  project: Project,
  input: unknown,
  planning?: Planning,
  snapshot?: Snapshot,
) {
  assertPlanCurrent(plan, project, planning, snapshot);
  if (plan.generated)
    throw new Error("Analyze a fresh plan before proposing additional cases");
  if (plan.candidates.length >= 500)
    throw new Error("Split intake into plans of at most 500 candidates");
  const proposal = CaseProposal.parse(input);
  for (const ref of proposal.evidence) {
    const file = snapshot?.files.find((f) => f.path === ref.source);
    const manual = planning?.cases.find(
      (c) =>
        `${c.source}#${c.externalId}` === ref.source &&
        c.revision === ref.revision,
    );
    const refs = [
      ...(planning?.stories.map((s) => s.evidence) ?? []),
      ...(planning?.documents.map((d) => d.evidence) ?? []),
      ...(planning?.features.map((f) => f.evidence) ?? []),
    ];
    const supported =
      (file &&
        snapshot?.revision === ref.revision &&
        file.content.includes(ref.excerpt)) ||
      (manual && JSON.stringify(manual.steps).includes(ref.excerpt)) ||
      refs.some(
        (r) =>
          r.source === ref.source &&
          r.revision === ref.revision &&
          r.excerpt.includes(ref.excerpt),
      );
    if (!supported)
      throw new Error(
        "Every proposed case must cite an exact excerpt from currently loaded source evidence and its revision",
      );
  }
  if (
    plan.candidates.some(
      (c) => c.title.toLowerCase() === proposal.title.toLowerCase(),
    ) ||
    project.tests.some(
      (t) => t.title.toLowerCase() === proposal.title.toLowerCase(),
    )
  )
    throw new Error(
      "An existing case or test already has this title; reuse it instead",
    );
  plan.candidates.push({
    ...proposal,
    id: `SQ-I-${key(canonical(proposal.evidence) + proposal.title)}`,
    disposition: "current",
    origin: "ai",
    selected: true,
    dependsOn: [],
    existingTestIds: [],
    questions: [
      "Agent-proposed scenario: exact citations establish provenance, not correctness of inferred behavior. A QE must confirm business expectations and semantic overlap with existing tests.",
    ],
  });
  delete plan.review;
}
