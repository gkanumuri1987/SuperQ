import { canonical } from "./identity.js";
import type { CaseProposal, Candidate } from "./intake.js";
import type { z } from "zod";

export const PROPOSAL_CHECK_VERSION = "1";
export type ProposalFinding = {
  code:
    | "empty-step"
    | "vacuous-assertion"
    | "contradictory-assertions"
    | "duplicate-flow"
    | "vague-expectation"
    | "status-only"
    | "mapping-needed";
  severity: "blocker" | "review";
  detail: string;
  step?: number;
  relatedCandidateId?: string;
};
export type ProposalQuality = {
  version: string;
  status: "blocked" | "needs-review";
  findings: ProposalFinding[];
  assertions: number;
  semanticValidation: "requires-qe-review";
};
/** Deterministic lint only: citations and model agreement do not establish business correctness. */
export function assessProposal(
  proposal: z.infer<typeof CaseProposal>,
  existing: Pick<Candidate, "id" | "steps" | "recipe">[] = [],
): ProposalQuality {
  const findings: ProposalFinding[] = [];
  const normalized = (steps: typeof proposal.steps) =>
    canonical(
      steps.map((s) => ({
        action: s.action.trim().replace(/\s+/g, " "),
        expected: s.expected.trim().replace(/\s+/g, " "),
      })),
    );
  proposal.steps.forEach((s, i) => {
    if (!s.action.trim() || !s.expected.trim())
      findings.push({
        code: "empty-step",
        severity: "blocker",
        step: i + 1,
        detail: "Provide an action and an observable expected result.",
      });
    else if (
      /^(?:works?(?: as expected)?|success(?:ful(?:ly)?)?|pass(?:ed)?|as expected|correct(?:ly)?|verify result|tbd)[.!]?$/i.test(
        s.expected.trim(),
      )
    )
      findings.push({
        code: "vague-expectation",
        severity: "review",
        step: i + 1,
        detail:
          "Replace the generic result with a business outcome from the specification.",
      });
  });
  const duplicate = existing.find(
    (c) =>
      normalized(c.steps) === normalized(proposal.steps) ||
      (!!c.recipe &&
        !!proposal.recipe &&
        canonical(c.recipe) === canonical(proposal.recipe)),
  );
  if (duplicate)
    findings.push({
      code: "duplicate-flow",
      severity: "review",
      relatedCandidateId: duplicate.id,
      detail:
        "An existing candidate has the same steps or executable recipe. Review scope and reuse before adding another test.",
    });
  let assertions = 0;
  if (!proposal.recipe)
    findings.push({
      code: "mapping-needed",
      severity: "review",
      detail:
        "Map actions and explicit assertions before executing this scenario.",
    });
  else if (proposal.recipe.kind === "api") {
    proposal.recipe.requests.forEach((r, i) => {
      const equalities = new Map<string, string>();
      for (const a of r.assertions) {
        assertions++;
        if (
          (a.operator === "contains" && a.expected === "") ||
          (a.operator === "matches" &&
            ["", ".*", "^.*$", "(?:)", "[\\s\\S]*", "^[\\s\\S]*$"].includes(
              String(a.expected),
            ))
        )
          findings.push({
            code: "vacuous-assertion",
            severity: "blocker",
            step: i + 1,
            detail:
              "This assertion accepts every string. Specify a meaningful expected result.",
          });
        if (a.operator === "equals") {
          const value = canonical(a.expected);
          if (/\$\{[\w.-]+\}/.test(value)) continue;
          if (equalities.has(a.path) && equalities.get(a.path) !== value)
            findings.push({
              code: "contradictory-assertions",
              severity: "blocker",
              step: i + 1,
              detail:
                "One response field has incompatible equality assertions in the same request.",
            });
          equalities.set(a.path, value);
        }
      }
    });
    if (
      proposal.recipe.requests.every((r) =>
        r.assertions.every((a) => a.path === "status"),
      )
    )
      findings.push({
        code: "status-only",
        severity: "review",
        detail:
          "Only HTTP status is checked. Confirm whether the specification also requires response content or business effects.",
      });
  } else
    assertions = proposal.recipe.commands.filter((c) =>
      c.type.startsWith("expect"),
    ).length;
  return {
    version: PROPOSAL_CHECK_VERSION,
    status: findings.some((f) => f.severity === "blocker")
      ? "blocked"
      : "needs-review",
    findings,
    assertions,
    semanticValidation: "requires-qe-review",
  };
}
