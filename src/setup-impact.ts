import type { Project } from "./model.js";
/** Direct changes require review; downstream tests may be blocked by those prerequisites. */
export function setupImpact(project: Project, id: string) {
  const referencingTests = project.tests
    .filter((t) =>
      t.steps.some(
        (s) => Array.isArray(s.input.setupIds) && s.input.setupIds.includes(id),
      ),
    )
    .map((t) => t.id);
  const direct = new Set(referencingTests);
  const affected = new Set(referencingTests);
  const children = new Map<string, string[]>();
  for (const test of project.tests)
    for (const parent of test.dependsOn) {
      const existing = children.get(parent);
      if (existing) existing.push(test.id);
      else children.set(parent, [test.id]);
    }
  const pending = [...referencingTests];
  while (pending.length) {
    for (const child of children.get(pending.pop()!) ?? [])
      if (!affected.has(child)) {
        affected.add(child);
        pending.push(child);
      }
  }
  return {
    referencingTests,
    dependentTests: project.tests
      .filter((t) => affected.has(t.id) && !direct.has(t.id))
      .map((t) => t.id),
  };
}
