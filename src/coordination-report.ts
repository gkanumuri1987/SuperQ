import type { Coordination } from "./coordinator.js";
/** Export only explicit diagnostics: no raw prompts, proposal values, source excerpts or plan contents. */
export function coordinationReport(job: Coordination) {
  return {
    schemaVersion: 1,
    jobId: job.id,
    at: job.at,
    model: job.model,
    resolvedModels: job.resolvedModels,
    state: job.state,
    scope:
      "Deterministic proposal checks and model workflow telemetry; not a model accuracy benchmark or production certification.",
    projectFingerprint: job.project,
    sourceFingerprint: job.sources,
    proposedCases: job.proposals?.length ?? 0,
    reviewerAccepted: job.review?.accepted.length ?? 0,
    reviewerIssueCount: job.review?.issues.length ?? 0,
    humanApproval: "required",
    diagnostics: job.diagnostics,
    proposals: job.quality?.map((q, index) => ({
      index,
      status: q.status,
      assertions: q.assertions,
      semanticValidation: q.semanticValidation,
      findings: q.findings.map(({ code, severity, step }) => ({
        code,
        severity,
        step,
      })),
    })),
  };
}
