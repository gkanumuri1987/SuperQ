import { z } from "zod";

/** Bounded, deterministic combinatorial design. This measures input coverage, not correctness. */
export const TestDesign = z
  .object({
    title: z.string().trim().min(1).max(200),
    evidence: z.object({
      source: z.string().trim().min(1),
      revision: z.string().trim().min(1),
      excerpt: z.string().trim().min(1),
    }),
    factors: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(100),
          values: z.array(z.string().min(1).max(200)).min(1).max(10),
        }),
      )
      .min(2)
      .max(8),
    forbidden: z.array(z.record(z.string(), z.string())).max(100).default([]),
  })
  .strict()
  .superRefine((d, ctx) => {
    const names = d.factors.map((f) => f.name);
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (new Set(names).size !== names.length)
      issue("Factor names must be unique");
    for (const f of d.factors)
      if (new Set(f.values).size !== f.values.length)
        issue(`Values must be unique for ${f.name}`);
    for (const rule of d.forbidden) {
      if (!Object.keys(rule).length)
        issue("Forbidden combinations must not be empty");
      for (const [name, value] of Object.entries(rule))
        if (!d.factors.some((f) => f.name === name && f.values.includes(value)))
          issue(`Unknown forbidden factor/value: ${name}`);
    }
  });
export type TestDesign = z.infer<typeof TestDesign>;
export function designPairwise(input: unknown) {
  const d = TestDesign.parse(input);
  const theoretical = d.factors.reduce((n, f) => n * f.values.length, 1);
  if (theoretical > 4096)
    throw new Error(
      "Design exceeds 4096 candidate combinations. Split the model into smaller business contexts.",
    );
  let candidates: Record<string, string>[] = [{}];
  for (const f of d.factors)
    candidates = candidates.flatMap((row) =>
      f.values.map((v) => ({ ...row, [f.name]: v })),
    );
  candidates = candidates.filter(
    (row) =>
      !d.forbidden.some((rule) =>
        Object.entries(rule).every(([k, v]) => row[k] === v),
      ),
  );
  if (!candidates.length)
    throw new Error(
      "Constraints exclude every combination. Review the model before generating.",
    );
  const obligations = (row: Record<string, string>) => {
    const keys: string[] = [];
    for (let i = 0; i < d.factors.length; i++) {
      const a = d.factors[i]!;
      keys.push(JSON.stringify([a.name, row[a.name]]));
      for (let j = i + 1; j < d.factors.length; j++) {
        const b = d.factors[j]!;
        keys.push(JSON.stringify([a.name, row[a.name], b.name, row[b.name]]));
      }
    }
    return keys;
  };
  const indexed = candidates.map((row) => ({ row, keys: obligations(row) }));
  const remaining = new Set(indexed.flatMap((x) => x.keys));
  const required = remaining.size;
  const rows: Record<string, string>[] = [];
  let work = 0;
  while (remaining.size) {
    let best: (typeof indexed)[number] | undefined,
      bestGain = 0;
    for (const item of indexed) {
      let gain = 0;
      for (const key of item.keys) {
        if (++work > 20_000_000)
          throw new Error(
            "Design exceeded its computation budget. Split the model into smaller contexts. No partial design was returned.",
          );
        if (remaining.has(key)) gain++;
      }
      if (gain > bestGain) {
        best = item;
        bestGain = gain;
      }
    }
    if (!best) throw new Error("Unable to cover the remaining combinations");
    rows.push(best.row);
    for (const key of best.keys) remaining.delete(key);
  }
  const infeasibleValues = d.factors.flatMap((f) =>
    f.values
      .filter((v) => !candidates.some((row) => row[f.name] === v))
      .map((value) => ({ factor: f.name, value })),
  );
  return {
    schemaVersion: 1,
    algorithm: "deterministic-greedy-pairwise-v1",
    title: d.title,
    evidence: d.evidence,
    model: d,
    summary: {
      theoreticalCombinations: theoretical,
      validCombinations: candidates.length,
      selectedRows: rows.length,
      requiredObligations: required,
      coveredObligations: required,
      interactionStrength: 2,
    },
    rows,
    infeasibleValues,
    reviewRequired: true,
    applicationCoverageProven: false,
    limitations: [
      "Coverage is limited to feasible single values and pairs in the supplied model.",
      "Higher-order interactions, business assertions and domain completeness need separate tests.",
      "Constraints and source evidence are user supplied and require review. This is not a minimum-size guarantee.",
    ],
  };
}
