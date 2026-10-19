import { createHash } from "node:crypto";
import { Recipe } from "../src/intake.js";
import { validateProject } from "../src/model.js";
import { Planning } from "../src/planning.js";
import type { Snapshot } from "../src/knowledge.js";
export const fixtureProject = (url = "http://127.0.0.1:1/") =>
  validateProject({
    name: "Intake fixture",
    requirements: [],
    catalog: [],
    tests: [],
    environments: { test: { baseURL: url } },
    suites: { functional: {} },
  });
export const fixtureInventory = () =>
  Planning.parse({
    features: [
      {
        id: "health",
        title: "Service health",
        module: "Ops",
        lifecycle: "active",
        evidence: {
          source: "ED",
          revision: "1",
          excerpt: "Health shows Ready",
        },
      },
    ],
    cases: [
      {
        source: "ADO",
        externalId: "1",
        revision: "4",
        title: "Service health",
        featureIds: ["health"],
        steps: [{ action: "Open the health page", expected: "Ready" }],
      },
    ],
  });
export const fixtureSnapshot = (): Snapshot => {
  const content = JSON.stringify({
    openapi: "3.1.0",
    paths: {
      "/api/health": {
        get: {
          responses: {
            "200": {
              description: "Healthy service",
              content: { "application/json": { example: { status: "ok" } } },
            },
          },
        },
      },
    },
  });
  return {
    revision: "a".repeat(40),
    files: [
      {
        path: "openapi.json",
        content,
        hash: createHash("sha256").update(content).digest("hex"),
      },
    ],
  };
};
export const webRecipe = () =>
  Recipe.parse({
    kind: "web",
    commands: [
      { type: "goto", path: "/" },
      {
        type: "expectText",
        locator: { strategy: "text", value: "Ready" },
        value: "Ready",
      },
    ],
  });
