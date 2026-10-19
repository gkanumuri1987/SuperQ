import { z } from "zod";
import type { Project } from "./model.js";
import { SetupIds, webCommandSchema } from "./web-commands.js";
import { ensureLocator } from "./catalog.js";
import { canonical } from "./identity.js";
import type { Recipe } from "./intake.js";
export function setupCommands(project: Project, ids: unknown) {
  return SetupIds.parse(ids ?? []).flatMap((id) => {
    const setup = Object.hasOwn(project.webSetups ?? {}, id)
      ? project.webSetups![id]
      : undefined;
    if (!setup) throw new Error(`Unknown web setup ${id}`);
    return setup.commands.map((command, index) => ({
      command,
      setupId: id,
      index: index + 1,
    }));
  });
}
export function journeyCommands(project: Project, input: unknown) {
  const i = z
    .object({
      setupIds: SetupIds.optional(),
      commands: z
        .array(webCommandSchema(z.string().min(1), z.string().min(1)))
        .min(1)
        .max(100),
    })
    .strict()
    .parse(input);
  return [
    ...setupCommands(project, i.setupIds),
    ...i.commands.map((command, index) => ({
      command,
      index: index + 1,
      setupId: undefined,
    })),
  ];
}
/** Extract a reviewed prefix into one live catalog reference, retaining the test's own oracle. */
export function extractSetup(
  project: Project,
  recipe: Recipe,
  id: string,
  title: string,
  count: number,
) {
  if (recipe.kind !== "web" || recipe.setupIds?.length)
    throw new Error("Choose a web mapping with no existing setup");
  if (
    !/^[a-zA-Z][\w.-]{0,79}$/.test(id) ||
    ["constructor", "prototype", "__proto__"].includes(id)
  )
    throw new Error("Use a simple unique setup ID");
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 40 ||
    count >= recipe.commands.length
  )
    throw new Error(
      "Choose a prefix of 1–40 commands, keeping assertions in the case",
    );
  const prefix = recipe.commands.slice(0, count);
  if (
    prefix[0]?.type !== "goto" ||
    prefix.some(
      (c) =>
        !["goto", "click", "fill", "selectOption", "check", "uncheck"].includes(
          c.type,
        ),
    )
  )
    throw new Error(
      "Extract navigation and interactions only; retain every assertion in the case",
    );
  const setup = {
    title,
    commands: prefix.map((c) =>
      "locator" in c ? { ...c, locator: ensureLocator(project, c.locator) } : c,
    ),
  };
  if (
    Object.values(project.webSetups ?? {}).some(
      (s) => canonical(s.commands) === canonical(setup.commands),
    )
  )
    throw new Error("This setup already exists; reuse its ID");
  if (Object.hasOwn(project.webSetups ?? {}, id))
    throw new Error("Setup ID already exists");
  project.webSetups ??= {};
  project.webSetups[id] = setup;
  return { ...recipe, setupIds: [id], commands: recipe.commands.slice(count) };
}

/** Discovery metadata for agents; entered literal values stay in the local project. */
export function setupCatalog(project: Project) {
  return Object.entries(project.webSetups ?? {}).map(([id, s]) => ({
    id,
    title: s.title,
    steps: s.commands.map((c) => ({
      type: c.type,
      ...("locator" in c ? { locator: c.locator } : {}),
      dataKeys: [...JSON.stringify(c).matchAll(/\$\{([^}]+)\}/g)].map(
        (m) => m[1]!,
      ),
    })),
  }));
}
