import { canonical, projectFingerprint } from "./identity.js";
import { validateProject, type Project, type Result } from "./model.js";
export function stageRepair(
  project: Project,
  result: Result,
  sourceFingerprint: string,
  observationIndex: number,
) {
  if (sourceFingerprint !== projectFingerprint(project))
    throw new Error(
      "Project changed after the healing trial; rerun before staging a repair",
    );
  if (result.status !== "passed" || !result.healed)
    throw new Error(
      "Only a passing speculative repair can be staged for review",
    );
  const observation = result.observations?.[observationIndex];
  if (
    !observation ||
    observation.operation !== "web.heal" ||
    observation.status !== "passed" ||
    !observation.locator ||
    !observation.replacement ||
    !observation.command
  )
    throw new Error("Choose a recorded healing observation");
  if (
    !project.healing?.locators[observation.locator]?.includes(
      observation.replacement,
    )
  )
    throw new Error("The alternative is no longer configured in the catalog");
  const p = structuredClone(project),
    test = p.tests.find((t) => t.id === result.id),
    step = test?.steps[observation.step - 1];
  if (!test || !step) throw new Error("Test or step no longer exists");
  const commands = step.input.commands as Record<string, unknown>[] | undefined;
  const command = commands?.[observation.command - 1];
  if (!command || command.locator !== observation.locator)
    throw new Error("The original command changed; rerun the trial");
  const assertions = canonical(test.steps.map((s) => s.assertions));
  if (["text", "expectText"].includes(String(command.type)))
    command.captureAs ??= observation.locator;
  command.locator = observation.replacement;
  test.status = "draft";
  delete test.review;
  if (assertions !== canonical(test.steps.map((s) => s.assertions)))
    throw new Error("Repairs cannot change assertions");
  return validateProject(p);
}
