import { assessProposal } from "./proposal-quality.js";
import { setupCommands } from "./web-setups.js";
import { SetupIds } from "./web-commands.js";
import {
  LocatorDefinition as locator,
  RelativePath as relativePath,
  webCommandSchema,
} from "./web-commands.js";
import { ensureAction, ensureLocator } from "./catalog.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Assertion, validateProject, type Project } from "./model.js";
import { canonical, projectFingerprint } from "./identity.js";
import { type Planning } from "./planning.js";
import type { Snapshot } from "./knowledge.js";
import { resolveAccount, resolveData } from "./runner.js";

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
      setupIds: SetupIds.optional(),
      commands: z.array(webCommandSchema(locator)).min(1).max(100),
    })
    .strict()
    .refine(
      (r) =>
        (r.commands[0]?.type === "goto" || !!r.setupIds?.length) &&
        r.commands.some((c) => c.type.startsWith("expect")),
      "A web flow needs initial navigation and an explicit native assertion",
    ),
]);
export type Recipe = z.infer<typeof Recipe>;
const Ref = z.object({
  source: z.string().trim().min(1),
  revision: z.string().trim().min(1),
  excerpt: z
    .string()
    .min(1)
    .refine((value) => !!value.trim(), "Evidence excerpt must contain text"),
});
export const IntakePlan = z.object({
  id: z.string(),
  createdAt: z.string(),
  mode: z.enum(["repository", "inventory", "combined", "requirements"]),
  environment: z.string(),
  preference: z.enum(["api", "web"]),
  context: z.object({ project: z.string(), sources: z.string() }),
  candidates: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      requirementId: z.string().optional(),
      criterionId: z.string().optional(),
      targetTestId: z.string().optional(),
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
  if (
    !repo &&
    !inventory &&
    !project.requirements.some((r) => r.criteria.length)
  )
    throw new Error(
      "Scan committed repository sources or import manual test inventory first. A repository URL alone is not application knowledge; documented acceptance criteria can also supply a starting point.",
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
    const unimplemented =
      existingTestIds.length === 1
        ? project.tests.find(
            (t) => t.id === existingTestIds[0] && !t.steps.length,
          )
        : undefined;
    candidates.push({
      id: `SQ-I-${key(identity)}`,
      origin: "ai",
      title,
      evidence,
      steps,
      dependsOn: [],
      disposition: "current",
      selected: existingTestIds.length === 0 || !!unimplemented,
      ...(unimplemented ? { targetTestId: unimplemented.id } : {}),
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
  for (const requirement of project.requirements)
    for (const criterion of requirement.criteria) {
      const linked = project.tests.filter((t) =>
        t.covers[requirement.id]?.includes(criterion.id),
      );
      if (linked.some((t) => t.steps.length)) continue;
      const title =
        linked.length === 1
          ? linked[0]!.title
          : `${requirement.title}: ${criterion.title}`;
      if (
        candidates.some(
          (c) => c.title.trim().toLowerCase() === title.trim().toLowerCase(),
        )
      )
        continue;
      add(
        `criterion:${requirement.id}:${criterion.id}`,
        title,
        project.evidence
          .filter((e) => requirement.evidenceIds.includes(e.id))
          .map(({ source, revision, excerpt }) => ({
            source,
            revision,
            excerpt,
          })),
        [
          {
            action: "Map the actions that exercise this acceptance criterion",
            expected: criterion.title,
          },
        ],
        {
          requirementId: requirement.id,
          criterionId: criterion.id,
          ...(linked.length === 1
            ? { targetTestId: linked[0]!.id, existingTestIds: [linked[0]!.id] }
            : {}),
          questions: [
            "Existing documented criterion has no executable case. Confirm coverage and map an explicit flow; no application behavior was inferred.",
          ],
        },
      );
    }
  for (const candidate of candidates) {
    if (
      project.tests.some((t) => t.id === candidate.id) &&
      !candidate.existingTestIds.includes(candidate.id)
    )
      candidate.existingTestIds.push(candidate.id);
    if (candidate.targetTestId && candidate.disposition === "current")
      candidate.selected = true;
    if (candidate.existingTestIds.length && !candidate.targetTestId)
      candidate.selected = false;
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
  if (snapshot?.discovery?.scope) {
    const paths = new Set(snapshot.files.map((f) => f.path));
    questions.push(
      `Focused module: ${snapshot.discovery.scope.module}. Confirm integrations and shared-document relevance; other modules have not been analyzed.`,
    );
    for (const candidate of candidates) {
      if (!candidate.evidence.some((e) => paths.has(e.source))) {
        candidate.selected = false;
        candidate.questions.push(
          "No evidence linked to the active module context. Confirm scope before selecting this case.",
        );
      }
    }
  }
  if (candidates.length > 500)
    throw new Error(
      "Limit intake to 500 candidates per plan; split the source inventory.",
    );
  return IntakePlan.parse({
    id: `intake-${Date.now()}-${key(candidates.map((c) => c.id).join())}`,
    createdAt: new Date().toISOString(),
    mode:
      repo && inventory
        ? "combined"
        : repo
          ? "repository"
          : inventory
            ? "inventory"
            : "requirements",
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
  const addLocator = (definition: z.infer<typeof locator>) =>
    ensureLocator(p, definition);
  for (const c of selected) {
    validateCoverageLink(p, c);
    const qualityBlocker = assessProposal(c).findings.find(
      (f) => f.severity === "blocker",
    );
    if (qualityBlocker)
      throw new Error(`Proposal quality: ${qualityBlocker.detail}`);
    if (c.disposition !== "current")
      throw new Error(
        `${c.title}: resolve scope or lifecycle before automation`,
      );
    if (c.existingTestIds.length && !c.targetTestId)
      throw new Error(
        `${c.title}: existing automation found; review it in the test library instead of duplicating work`,
      );
    if (!c.recipe || c.recipe.kind !== plan.preference)
      throw new Error(
        `${c.title}: map ${plan.preference} steps and expected assertions first`,
      );
    const previous = c.targetTestId
      ? p.tests.find((t) => t.id === c.targetTestId)
      : undefined;
    if (c.targetTestId && (!previous || previous.steps.length))
      throw new Error(
        "Existing automation must be maintained instead of overwritten",
      );
    if (!c.targetTestId && p.tests.some((t) => t.id === c.id))
      throw new Error(
        `${c.title}: already generated; reuse the existing draft`,
      );
    let req = c.requirementId ?? previous?.requirementIds[0] ?? `REQ-${c.id}`;
    let criterion = c.criterionId ?? previous?.covers[req]?.[0] ?? "expected";
    const candidateEvidenceIds = c.evidence.map((e) => {
      const existing = p.evidence.find(
        (reference) =>
          reference.source === e.source &&
          reference.revision === e.revision &&
          reference.excerpt === e.excerpt,
      );
      if (existing) return existing.id;
      const id = `EV-${key(canonical(e))}`;
      if (p.evidence.some((reference) => reference.id === id))
        throw new Error("Intake evidence ID collision");
      p.evidence.push({ id, ...e });
      return id;
    });
    let evidenceIds: string[];
    const existingRequirement = p.requirements.find((r) => r.id === req);
    if (existingRequirement) {
      if (!existingRequirement.criteria.some((ac) => ac.id === criterion))
        throw new Error(
          "Choose an existing acceptance criterion for this case",
        );
      evidenceIds = [
        ...new Set([
          ...existingRequirement.evidenceIds,
          ...candidateEvidenceIds,
        ]),
      ];
    } else {
      evidenceIds = candidateEvidenceIds;
      p.requirements.push({
        id: req,
        title: c.title,
        risk: "medium",
        criteria: [
          { id: criterion, title: c.steps.map((s) => s.expected).join("; ") },
        ],
        evidenceIds,
      });
    }
    const operation = c.recipe.kind === "api" ? "request" : "journey";
    const actionId = ensureAction(
      p,
      c.recipe.kind,
      operation,
      "Reviewed intake automation",
    );
    const steps: Project["tests"][number]["steps"] = [];
    if (c.recipe.kind === "api")
      for (const r of c.recipe.requests)
        steps.push({
          action: actionId,
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
        if (command.type === "expectURL") {
          assertions.push({
            path: `checkpoints.${index + 1}`,
            operator: "equals",
            expected: command.path,
          });
          return command;
        }
        const id = addLocator(command.locator);
        if (command.type.startsWith("expect"))
          assertions.push({
            path: `checkpoints.${index + 1}`,
            operator: "equals",
            expected:
              "value" in command
                ? command.value
                : command.type === "expectCount"
                  ? command.count
                  : true,
          });
        return { ...command, locator: id };
      });
      steps.push({
        action: actionId,
        input: {
          commands,
          ...(c.recipe.setupIds?.length ? { setupIds: c.recipe.setupIds } : {}),
        },
        assertions,
        save: {},
      });
    }
    const test: Project["tests"][number] = {
      ...(previous ?? {}),
      id: c.targetTestId ?? c.id,
      title: c.title,
      role: c.role ?? previous?.role,
      user: c.user ?? previous?.user,
      anonymous: c.anonymous ?? previous?.anonymous,
      origin: previous?.origin ?? c.origin,
      status: "draft",
      requirementIds: [...new Set([...(previous?.requirementIds ?? []), req])],
      covers: {
        ...previous?.covers,
        [req]: [...new Set([...(previous?.covers[req] ?? []), criterion])],
      },
      evidenceIds: [
        ...new Set([...(previous?.evidenceIds ?? []), ...evidenceIds]),
      ],
      suites: [...new Set([...(previous?.suites ?? []), "intake"])],
      tags: [
        ...new Set([...(previous?.tags ?? []), "intake", plan.preference]),
      ],
      dependsOn: [
        ...new Set([
          ...(previous?.dependsOn ?? []),
          ...c.dependsOn.map(
            (id) =>
              plan.candidates.find((candidate) => candidate.id === id)
                ?.targetTestId ?? id,
          ),
        ]),
      ],
      blockedBy: previous?.blockedBy ?? [],
      retrySafe: false,
      data: previous?.data ?? {},
      steps,
    };
    delete test.review;
    if (previous) p.tests[p.tests.indexOf(previous)] = test;
    else p.tests.push(test);
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
    for (const finding of assessProposal(c).findings.filter(
      (f) => f.severity === "blocker",
    ))
      block(
        "proposal-quality",
        finding.detail,
        "Correct the mapped assertion or expected result, then review the plan again.",
      );
    if (c.disposition !== "current")
      block(
        "scope",
        c.disposition,
        "Confirm scope/lifecycle and analyze the updated inventory again.",
      );
    if (c.existingTestIds.length && !c.targetTestId)
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
      const t = p.tests.find((t) => t.id === (c.targetTestId ?? c.id))!;
      try {
        if (t.blockedBy.length) {
          blockers.push({
            candidateId: c.id,
            kind: "dependency",
            detail: `Unresolved case blockers: ${t.blockedBy.join(", ")}`,
            resolution:
              "Resolve the existing case blockers before approving an automation plan.",
          });
          continue;
        }
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
          ...canonical({
            recipe: c.recipe,
            setups:
              c.recipe?.kind === "web"
                ? setupCommands(p, c.recipe.setupIds).map((e) => ({
                    ...e,
                    definition:
                      "locator" in e.command
                        ? p.locators[e.command.locator]
                        : undefined,
                  }))
                : [],
          }).matchAll(/\$\{([^}]+)\}/g),
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

export const CoverageLink = z
  .object({ requirementId: z.string().min(1), criterionId: z.string().min(1) })
  .strict();
export function validateCoverageLink(
  project: Project,
  link: { requirementId?: string; criterionId?: string },
) {
  if (!link.requirementId && !link.criterionId) return;
  const requirement = project.requirements.find(
    (r) => r.id === link.requirementId,
  );
  if (
    !requirement ||
    !requirement.criteria.some((c) => c.id === link.criterionId)
  )
    throw new Error(
      "Choose an existing requirement and one of its acceptance criteria",
    );
}

export const CaseProposal = z
  .object({
    title: z.string().trim().min(1).max(300),
    requirementId: z.string().min(1).optional(),
    criterionId: z.string().min(1).optional(),
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
  validateCoverageLink(project, proposal);
  if (proposal.requirementId) {
    const requirement = project.requirements.find(
      (r) => r.id === proposal.requirementId,
    )!;
    if (
      !proposal.evidence.some((ref) =>
        project.evidence.some(
          (e) =>
            requirement.evidenceIds.includes(e.id) &&
            e.source === ref.source &&
            e.revision === ref.revision &&
            e.excerpt.includes(ref.excerpt),
        ),
      )
    )
      throw new Error(
        "Linked AI proposals must cite current evidence for the selected requirement",
      );
  }
  const quality = assessProposal(proposal, plan.candidates);
  if (quality.status === "blocked")
    throw new Error(
      `Proposal quality: ${quality.findings
        .filter((f) => f.severity === "blocker")
        .map((f) => f.detail)
        .join(" ")}`,
    );
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
      project.evidence.some(
        (r) =>
          r.source === ref.source &&
          r.revision === ref.revision &&
          r.excerpt.includes(ref.excerpt),
      ) ||
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
      ...quality.findings.map((f) => f.detail),
    ],
  });
  delete plan.review;
}
