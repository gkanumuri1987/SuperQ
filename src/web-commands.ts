import { z } from "zod";
import type { Page } from "@playwright/test";
export const LocatorDefinition = z
  .object({
    strategy: z.enum(["role", "label", "text", "testId"]),
    value: z.string().min(1),
    name: z.string().optional(),
  })
  .strict();
export const RelativePath = z
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
export function webCommandSchema<T extends z.ZodType>(
  locator: T,
  path: z.ZodString = RelativePath,
) {
  const timing = { timeoutMs: z.number().int().min(1).max(60000).optional() };
  const capture = { captureAs: z.string().min(1).optional() };
  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("goto"), path }).strict(),
    z.object({ type: z.literal("expectURL"), path, ...timing }).strict(),
    z.object({ type: z.literal("click"), locator }).strict(),
    z.object({ type: z.literal("fill"), locator, value: z.string() }).strict(),
    z
      .object({ type: z.literal("selectOption"), locator, value: z.string() })
      .strict(),
    z.object({ type: z.literal("check"), locator }).strict(),
    z.object({ type: z.literal("uncheck"), locator }).strict(),
    z.object({ type: z.literal("text"), locator, ...capture }).strict(),
    z
      .object({
        type: z.literal("expectText"),
        locator,
        value: z.string().min(1),
        ...timing,
        ...capture,
      })
      .strict(),
    z
      .object({
        type: z.literal("expectValue"),
        locator,
        value: z.string(),
        ...timing,
      })
      .strict(),
    z.object({ type: z.literal("expectVisible"), locator, ...timing }).strict(),
    z
      .object({
        type: z.literal("expectCount"),
        locator,
        count: z.number().int().min(0),
        ...timing,
      })
      .strict(),
  ]);
}
export function resolveLocator(
  page: Page,
  definition: z.infer<typeof LocatorDefinition>,
) {
  return definition.strategy === "text"
    ? page.getByText(definition.value, { exact: true })
    : definition.strategy === "testId"
      ? page.getByTestId(definition.value)
      : definition.strategy === "label"
        ? page.getByLabel(definition.value, { exact: true })
        : page.getByRole(
            definition.value as Parameters<typeof page.getByRole>[0],
            { name: definition.name, exact: true },
          );
}
