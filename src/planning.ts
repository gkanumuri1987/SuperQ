import { z } from "zod";

const Ref = z.object({
  source: z.string().min(1),
  revision: z.string().min(1),
  excerpt: z.string().min(1),
});
export const Planning = z
  .object({
    team: z.string().default(""),
    sprint: z.string().default(""),
    features: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          module: z.string().min(1),
          lifecycle: z.enum(["active", "deprecated", "retired"]),
          evidence: Ref,
        }),
      )
      .default([]),
    stories: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          featureIds: z.array(z.string()),
          criteria: z.array(z.string().min(1)).min(1),
          evidence: Ref,
          boundaries: z
            .array(
              z.object({
                field: z.string().min(1),
                min: z.number(),
                max: z.number(),
                increment: z.number().positive(),
                evidence: Ref,
              }),
            )
            .default([]),
          integrations: z
            .array(
              z.object({
                name: z.string().min(1),
                contract: z.string().min(1),
                evidence: Ref,
              }),
            )
            .default([]),
        }),
      )
      .default([]),
    cases: z
      .array(
        z.object({
          source: z.string().min(1),
          externalId: z.string().min(1),
          revision: z.string().min(1),
          title: z.string().min(1),
          featureIds: z.array(z.string()),
          storyIds: z.array(z.string()).default([]),
          steps: z
            .array(
              z.object({
                action: z.string().min(1),
                expected: z.string().min(1),
              }),
            )
            .min(1),
          dependsOn: z.array(z.string()).default([]),
        }),
      )
      .default([]),
    documents: z
      .array(
        z.object({
          id: z.string().min(1),
          kind: z.string().min(1),
          featureIds: z.array(z.string()),
          evidence: Ref,
        }),
      )
      .default([]),
  })
  .superRefine((p, ctx) => {
    for (const [name, ids] of Object.entries({
      features: p.features.map((x) => x.id),
      stories: p.stories.map((x) => x.id),
      cases: p.cases.map(caseKey),
      documents: p.documents.map((x) => x.id),
    }))
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: "custom",
          message: `Duplicate ${name} identifiers`,
        });
    for (const story of p.stories)
      for (const b of story.boundaries)
        if (b.min > b.max)
          ctx.addIssue({
            code: "custom",
            message: `Invalid boundary for ${b.field}`,
          });
  });
export type Planning = z.infer<typeof Planning>;
export const caseKey = (c: { source: string; externalId: string }) =>
  `${c.source}:${c.externalId}`;
export function assessPlanning(input: unknown) {
  const p = Planning.parse(input),
    features = new Map(p.features.map((f) => [f.id, f])),
    cases = new Map(p.cases.map((c) => [caseKey(c), c]));
  const scope = new Set(p.stories.flatMap((s) => s.featureIds));
  const triage = p.cases.map((c) => {
    const fs = c.featureIds.map((id) => features.get(id));
    const lifecycle =
      !fs.length || fs.some((f) => !f)
        ? "needs-context"
        : fs.every((f) => f!.lifecycle === "retired")
          ? "obsolete-candidate"
          : fs.some((f) => f!.lifecycle !== "active")
            ? "deprecated-review"
            : "active";
    const dependencies = c.dependsOn.map((id) => ({
      id,
      resolution: !cases.has(id)
        ? "Import the missing prerequisite or replace it with an explicit setup fixture."
        : "Prefer an independent setup fixture; otherwise run this prerequisite first.",
    }));
    const visit = (id: string, path: string[]): boolean =>
      path.includes(id) ||
      !!cases.get(id)?.dependsOn.some((next) => visit(next, [...path, id]));
    return {
      key: caseKey(c),
      title: c.title,
      lifecycle,
      scope:
        !p.stories.length || !fs.length || fs.some((f) => !f)
          ? "needs-context"
          : c.featureIds.some((id) => scope.has(id))
            ? "in-scope"
            : "out-of-current-sprint",
      dependencies,
      cycle: visit(caseKey(c), []),
      evidence: fs.filter((f) => !!f).map((f) => f!.evidence),
      reviewRequired: lifecycle !== "active",
    };
  });
  const proposals = p.stories.map((s) => {
    const linked = p.cases.filter((c) => c.storyIds.includes(s.id));
    return {
      storyId: s.id,
      title: s.title,
      linkedCases: linked.map(caseKey),
      questions: [
        ...s.featureIds
          .filter((id) => !features.has(id))
          .map((id) => `Provide current feature evidence for ${id}.`),
        ...(!s.boundaries.length
          ? [
              "Provide domain partitions, valid limits, inclusivity and precision before generating equivalence and boundary values.",
            ]
          : []),
        ...(!s.integrations.length
          ? ["Confirm module integrations and their contracts."]
          : []),
      ],
      suggestions: [
        ...s.criteria.flatMap((criterion) => [
          {
            technique: "positive",
            intent: `Demonstrate: ${criterion}`,
            evidence: s.evidence,
          },
          {
            technique: "negative",
            intent: `Review invalid input, denied access and failure behavior for: ${criterion}; specify expected rejection before automation.`,
            evidence: s.evidence,
          },
        ]),
        ...s.boundaries.map((b) => ({
          technique: "equivalence / boundary",
          intent: `${b.field}: review ${[b.min - b.increment, b.min, b.min + b.increment, b.max - b.increment, b.max, b.max + b.increment].filter((v, i, a) => a.indexOf(v) === i).join(", ")}. Confirm inclusive limits and representative invalid partitions.`,
          evidence: b.evidence,
        })),
        ...s.integrations.map((i) => ({
          technique: "integration",
          intent: `${i.name}: verify contract ${i.contract}; review failure, timeout, authorization and recovery expectations.`,
          evidence: i.evidence,
        })),
      ],
      documentReviews: p.documents
        .filter((d) => d.featureIds.some((id) => s.featureIds.includes(id)))
        .map((d) => ({
          id: d.id,
          kind: d.kind,
          evidence: d.evidence,
          action:
            "Reconcile document assertions with story criteria and existing tests; resolve contradictions before approval.",
        })),
      status: "review-required" as const,
    };
  });
  return {
    triage,
    proposals,
    notice:
      "Repository access and linked cases do not establish complete feature knowledge or verified coverage. Suggestions require QE review; no tests are retired or approved automatically.",
  };
}
