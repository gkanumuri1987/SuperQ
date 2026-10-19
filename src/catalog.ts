import { createHash } from "node:crypto";
import { canonical } from "./identity.js";
import type { Project } from "./model.js";
const key = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex").slice(0, 16);
export function ensureAction(
  p: Project,
  kind: Project["catalog"][number]["kind"],
  operation: string,
  description: string,
) {
  const existing = p.catalog.find(
    (a) => a.kind === kind && a.operation === operation,
  );
  if (existing) return existing.id;
  const id = `shared.${kind}.${operation}`;
  if (p.catalog.some((a) => a.id === id))
    throw new Error("Catalog action ID collision");
  p.catalog.push({ id, kind, operation, description });
  return id;
}
export function ensureLocator(
  p: Project,
  definition: Project["locators"][string],
) {
  const existing = Object.entries(p.locators).find(
    ([, l]) => canonical(l) === canonical(definition),
  );
  if (existing) return existing[0];
  const id = `control-${key(definition)}`;
  if (Object.hasOwn(p.locators, id))
    throw new Error("Catalog locator ID collision");
  p.locators[id] = definition;
  return id;
}
export function catalogHealth(p: Project) {
  const usedActions = new Set(
    p.tests.flatMap((t) => t.steps.map((s) => s.action)),
  );
  const usedLocators = new Set<string>();
  for (const t of p.tests)
    for (const s of t.steps) {
      const visit = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        for (const [name, v] of Object.entries(value)) {
          if (["locator", "captureAs"].includes(name) && typeof v === "string")
            usedLocators.add(v);
          else visit(v);
        }
      };
      visit(s.input);
    }
  for (const [old, alternatives] of Object.entries(p.healing?.locators ?? {})) {
    usedLocators.add(old);
    alternatives.forEach((a) => usedLocators.add(a));
  }
  for(const setup of Object.values(p.webSetups??{}))for(const c of setup.commands)if('locator' in c)usedLocators.add(c.locator);
  const groups = new Map<string, string[]>();
  for (const t of p.tests)
    if (t.steps.length) {
      const signature = canonical({
        steps: t.steps.map((s) => ({
          ...s,
          action: p.catalog.find((a) => a.id === s.action),
        })),
        role: t.role,
        user: t.user,
        anonymous: t.anonymous,
      });
      groups.set(signature, [...(groups.get(signature) ?? []), t.id]);
    }
  return {
    actions: p.catalog.map((a) => ({
      ...a,
      testIds: p.tests
        .filter((t) => t.steps.some((s) => s.action === a.id))
        .map((t) => t.id),
    })),
    locators: Object.entries(p.locators).map(([id, definition]) => ({
      id,
      definition,
      testIds: p.tests
        .filter((t) =>
          t.steps.some((s) =>
            JSON.stringify({...s.input,setups:Array.isArray(s.input.setupIds)?s.input.setupIds.map(k=>p.webSetups?.[String(k)]):[]}).includes(JSON.stringify(id)),
          ),
        )
        .map((t) => t.id),
    })),
    unusedActions: p.catalog
      .filter((a) => !usedActions.has(a.id))
      .map((a) => a.id),
    unusedLocators: Object.keys(p.locators).filter(
      (id) => !usedLocators.has(id),
    ),
    duplicateCandidates: [...groups.values()].filter((ids) => ids.length > 1),
    notice:
      "Exact flow matches are review candidates for shared actions or parameterization. Different data, scope or business expectations may justify separate tests. Declared references do not cover external custom code; no automatic deletion occurs.",
  };
}
