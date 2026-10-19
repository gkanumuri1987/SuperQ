import { randomUUID, createHash } from "node:crypto";
import { canonical } from "./identity.js";
import { validateProject, type Project, type TestCase } from "./model.js";
export type ChangeDetail = {
  kind: "Validation" | "UI" | "Workflow" | "Functionality";
  label: string;
  before: string;
  after: string;
};
export type ReviewItem = {
  id: string;
  testId: string;
  title: string;
  reasons: string[];
  changes: ChangeDetail[];
  status: "pending" | "staged";
  resolution?: string;
  baseDefinition: string;
  candidate: TestCase;
};
export type MaintenancePlan = {
  id: string;
  title: string;
  createdAt: string;
  baseline: Project;
  candidate: Project;
  items: ReviewItem[];
  changedRequirements: string[];
  summary: string;
  source: "comparison" | "source-scan" | "sample";
  sourceStaged?: boolean;
};
const digest = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export function definition(t: TestCase) {
  const { review: _, status: __, ...rest } = t;
  return digest(rest);
}
const shared = (p: Project) =>
  digest({
    requirements: p.requirements,
    evidence: p.evidence,
    catalog: p.catalog,
    locators: p.locators,
  });
export function compareProjects(
  base: Project,
  incoming: unknown,
  title = "Application behavior changed",
  source: MaintenancePlan["source"] = "comparison",
): MaintenancePlan {
  const candidate = validateProject(incoming);
  if (candidate.name !== base.name)
    throw new Error("Compare versions of the same named project");
  if (base.tests.some((t) => !candidate.tests.some((n) => n.id === t.id)))
    throw new Error(
      "Test retirement needs an explicit project import; version comparison does not silently delete tests",
    );
  const changedRequirements = base.requirements
    .filter(
      (r) =>
        digest(r) !==
          digest(candidate.requirements.find((c) => c.id === r.id)) ||
        r.evidenceIds.some(
          (id) =>
            digest(base.evidence.find((e) => e.id === id)) !==
            digest(candidate.evidence.find((e) => e.id === id)),
        ),
    )
    .map((r) => r.id);
  changedRequirements.push(
    ...candidate.requirements
      .filter((r) => !base.requirements.some((old) => old.id === r.id))
      .map((r) => r.id),
  );
  const locators = new Set(
    [...Object.keys(base.locators), ...Object.keys(candidate.locators)].filter(
      (key) => digest(base.locators[key]) !== digest(candidate.locators[key]),
    ),
  );
  const actions = new Set(
    base.catalog
      .filter(
        (a) =>
          digest(a) !== digest(candidate.catalog.find((c) => c.id === a.id)),
      )
      .map((a) => a.id),
  );
  const affected = new Set(
    base.tests
      .filter(
        (t) =>
          t.requirementIds.some((id) => changedRequirements.includes(id)) ||
          t.steps.some(
            (s) =>
              actions.has(s.action) ||
              (JSON.stringify(s.input).includes('"locator"') &&
                [...locators].some((l) =>
                  JSON.stringify(s.input).includes(JSON.stringify(l)),
                )),
          ) ||
          definition(t) !==
            definition(candidate.tests.find((c) => c.id === t.id) ?? t),
      )
      .map((t) => t.id),
  );
  let more = true;
  while (more) {
    more = false;
    for (const t of base.tests)
      if (!affected.has(t.id) && t.dependsOn.some((d) => affected.has(d))) {
        affected.add(t.id);
        more = true;
      }
  }
  const items = base.tests
    .filter((t) => affected.has(t.id))
    .map((t) => {
      const next = candidate.tests.find((c) => c.id === t.id) ?? t;
      const changes: ChangeDetail[] = [];
      const reasons: string[] = [];
      for (const id of t.requirementIds.filter((id) =>
        changedRequirements.includes(id),
      )) {
        const old = base.requirements.find((r) => r.id === id),
          updated = candidate.requirements.find((r) => r.id === id);
        reasons.push(`${id}: acceptance criteria or source evidence changed`);
        changes.push({
          kind: "Functionality",
          label: `${id} · acceptance criteria`,
          before:
            old?.criteria.map((c) => c.title).join("\n") ??
            "Removed requirement",
          after:
            updated?.criteria.map((c) => c.title).join("\n") ??
            "Requirement removed — resolve mapping",
        });
      }
      for (const l of locators)
        if (
          t.steps.some((s) =>
            JSON.stringify(s.input).includes(JSON.stringify(l)),
          )
        ) {
          reasons.push(`Locator ${l} changed`);
          changes.push({
            kind: "UI",
            label: l,
            before: JSON.stringify(base.locators[l], null, 2),
            after: JSON.stringify(candidate.locators[l], null, 2),
          });
        }
      t.steps.forEach((s, index) => {
        const n = next.steps[index];
        if (n && digest(s.assertions) !== digest(n.assertions))
          changes.push({
            kind: "Validation",
            label: `Step ${index + 1} · expected results`,
            before: JSON.stringify(s.assertions, null, 2),
            after: JSON.stringify(n.assertions, null, 2),
          });
        if (n && digest(s.input) !== digest(n.input))
          changes.push({
            kind: "Workflow",
            label: `Step ${index + 1} · interaction or request`,
            before: JSON.stringify(s.input, null, 2),
            after: JSON.stringify(n.input, null, 2),
          });
      });
      if (t.steps.length !== next.steps.length)
        changes.push({
          kind: "Workflow",
          label: "Journey steps",
          before: JSON.stringify(t.steps, null, 2),
          after: JSON.stringify(next.steps, null, 2),
        });
      for (const id of t.evidenceIds) {
        const before = base.evidence.find((e) => e.id === id),
          after = candidate.evidence.find((e) => e.id === id);
        if (digest(before) !== digest(after))
          changes.push({
            kind: "Functionality",
            label: `${id} · supporting specification`,
            before: before?.excerpt ?? "No source",
            after: after?.excerpt ?? "Source removed — review needed",
          });
      }
      if (!reasons.length)
        reasons.push(
          t.dependsOn.some((d) => affected.has(d))
            ? "A prerequisite test is affected"
            : "Test definition or action changed",
        );
      return {
        id: randomUUID(),
        testId: t.id,
        title: t.title,
        reasons,
        changes,
        status: "pending" as const,
        baseDefinition: definition(t),
        candidate: next,
      };
    });
  return {
    id: randomUUID(),
    title,
    source,
    createdAt: new Date().toISOString(),
    baseline: structuredClone(base),
    candidate,
    items,
    changedRequirements,
    summary: `${items.length} existing tests need review. Suggestions are derived from the supplied version comparison; behavior still needs human validation.`,
  };
}
export function stageChanges(
  current: Project,
  plan: MaintenancePlan,
  itemIds: string[],
  preserveEdits = false,
) {
  if (
    (!itemIds.length && plan.items.length > 0) ||
    itemIds.some(
      (id) => !plan.items.some((i) => i.id === id && i.status === "pending"),
    )
  )
    throw new Error("Select pending review items");
  if (
    ![shared(plan.baseline), shared(plan.candidate)].includes(shared(current))
  )
    throw new Error("Project sources changed since analysis. Compare again.");
  for (const item of plan.items.filter((i) => itemIds.includes(i.id))) {
    const t = current.tests.find((t) => t.id === item.testId);
    if (!t || (!preserveEdits && definition(t) !== item.baseDefinition))
      throw new Error("Test changed since analysis. Compare again.");
  }
  const sharedChanged = shared(current) !== shared(plan.candidate);
  const next = structuredClone(current);
  next.requirements = plan.candidate.requirements;
  next.evidence = plan.candidate.evidence;
  next.locators = plan.candidate.locators;
  next.catalog = plan.candidate.catalog;
  for (const item of plan.items) {
    const index = next.tests.findIndex((t) => t.id === item.testId);
    if (index < 0) continue;
    if (itemIds.includes(item.id) && !preserveEdits)
      next.tests[index] = structuredClone(item.candidate);
    const t = next.tests[index]!;
    if (sharedChanged || itemIds.includes(item.id)) {
      t.status = "draft";
      delete t.review;
    }
  }
  for (const t of plan.candidate.tests)
    if (!next.tests.some((old) => old.id === t.id)) {
      const draft = structuredClone(t);
      draft.status = "draft";
      delete draft.review;
      next.tests.push(draft);
    }
  return validateProject(next);
}
