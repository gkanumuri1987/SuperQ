import { z } from "zod";
import { validateProject, type Project } from "./model.js";
const common = {
  id: z.string().regex(/^SQ-[a-zA-Z0-9-]+$/),
  title: z.string().trim().min(1),
  requirementId: z.string().min(1),
  criterionId: z.string().min(1),
  path: z.string().trim().min(1),
};
export const QuickTest = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("api"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    body: z.unknown().optional(),
    status: z.number().int().min(100).max(599).default(200),
    responseField: z.string().trim().min(1),
    expected: z
      .unknown()
      .refine((v) => v !== undefined, "Expected result required"),
  }),
  z.object({
    ...common,
    kind: z.literal("web"),
    fields: z
      .array(z.object({ label: z.string().trim().min(1), value: z.string() }))
      .max(20)
      .default([]),
    button: z.string().trim().default(""),
    expectation: z.object({
      kind: z.enum(["text", "heading", "status", "testId"]),
      text: z.string().min(1),
      target: z.string().trim().optional(),
    }),
  }),
]);
export type QuickTest = z.infer<typeof QuickTest>;
export function createQuickTest(project: Project, input: unknown) {
  const parsed = QuickTest.safeParse(input);
  if (!parsed.success) {
    const labels: Record<string, string> = {
      path: "application path",
      responseField: "response field",
      expected: "expected value",
      expectation: "expected screen text",
      fields: "field labels and values",
      status: "expected HTTP status",
    };
    const key = String(parsed.error.issues[0]?.path[0] ?? "test details");
    throw new Error(
      `Please check the ${labels[key] ?? "test details"} before creating the test.`,
    );
  }
  const i = parsed.data,
    p = structuredClone(project);
  if (p.tests.some((t) => t.id === i.id))
    throw new Error(
      "This test has already been saved. Open it from the test library.",
    );
  const requirement = p.requirements.find((r) => r.id === i.requirementId);
  if (!requirement?.criteria.some((c) => c.id === i.criterionId))
    throw new Error("Choose a current functional expectation.");
  const url = new URL(i.path, "http://superq.invalid/");
  if (
    url.origin !== "http://superq.invalid" ||
    url.username ||
    url.password ||
    /^[a-z]+:/i.test(i.path)
  )
    throw new Error("Use a path within the configured application.");
  const suite = Object.keys(p.suites)[0] ?? "functional";
  p.suites[suite] ??= { data: {} };
  const kind = i.kind === "api" ? "api" : "web",
    operation = i.kind === "api" ? "request" : "journey";
  let action = p.catalog.find(
    (a) => a.kind === kind && a.operation === operation,
  );
  const free = (base: string, keys: string[]) => {
    let key = base,
      n = 2;
    while (keys.includes(key)) key = `${base}-${n++}`;
    return key;
  };
  if (!action) {
    action = {
      id: free(
        `quick.${operation}`,
        p.catalog.map((a) => a.id),
      ),
      kind,
      operation,
      description:
        kind === "api"
          ? "Send a request and check the expected response"
          : "Follow a functional flow and check the screen",
    };
    p.catalog.push(action);
  }
  const locator = (def: Project["locators"][string]) => {
    const old = Object.entries(p.locators).find(
      ([, d]) =>
        d.strategy === def.strategy &&
        d.value === def.value &&
        d.name === def.name,
    );
    if (old) return old[0];
    const id = free("control", Object.keys(p.locators));
    p.locators[id] = def;
    return id;
  };
  let step;
  if (i.kind === "api") {
    const path = i.responseField.startsWith("body.")
      ? i.responseField
      : `body.${i.responseField}`;
    step = {
      action: action.id,
      input: {
        path: i.path,
        method: i.method,
        ...(i.body !== undefined ? { body: i.body } : {}),
      },
      assertions: [
        { path: "status", operator: "equals" as const, expected: i.status },
        { path, operator: "equals" as const, expected: i.expected },
      ],
    };
  } else {
    if (i.expectation.kind === "testId" && !i.expectation.target)
      throw new Error("Enter the result element test ID.");
    const commands: Record<string, unknown>[] = [
      { type: "goto", path: i.path },
    ];
    for (const field of i.fields)
      commands.push({
        type: "fill",
        locator: locator({ strategy: "label", value: field.label }),
        value: field.value,
      });
    if (i.button)
      commands.push({
        type: "click",
        locator: locator({ strategy: "role", value: "button", name: i.button }),
      });
    const target = locator(
      i.expectation.kind === "text"
        ? { strategy: "text", value: i.expectation.text }
        : i.expectation.kind === "testId"
          ? { strategy: "testId", value: i.expectation.target! }
          : {
              strategy: "role",
              value: i.expectation.kind,
              ...(i.expectation.kind === "heading"
                ? { name: i.expectation.text }
                : {}),
            },
    );
    commands.push({
      type: "expectText",
      locator: target,
      value: i.expectation.text,
    });
    step = {
      action: action.id,
      input: { commands },
      assertions: [
        {
          path: `text.${target}`,
          operator: "equals" as const,
          expected: i.expectation.text,
        },
      ],
    };
  }
  p.tests.push({
    id: i.id,
    title: i.title,
    status: "draft",
    origin: "qe",
    requirementIds: [requirement.id],
    covers: { [requirement.id]: [i.criterionId] },
    evidenceIds: [...requirement.evidenceIds],
    suites: [suite],
    tags: ["functional"],
    retrySafe: false,
    dependsOn: [],
    blockedBy: [],
    data: {},
    steps: [{ ...step, save: {} }],
  });
  return validateProject(p);
}
