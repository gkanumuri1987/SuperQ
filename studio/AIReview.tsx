import type { Coordination } from "../src/coordinator";
import { coordinationReport } from "../src/coordination-report";

export default function AIReview({ job }: { job: Coordination }) {
  if (!job.diagnostics) return null;
  const findings = job.quality?.flatMap((q) => q.findings) ?? [];
  const blockers = findings.filter((f) => f.severity === "blocker").length;
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(coordinationReport(job), null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `superq-ai-review-${job.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="automate-card" aria-label="AI proposal quality">
      <h3>AI proposal quality</h3>
      <p>
        {blockers} blocking findings · {findings.length - blockers} review notes
        · {job.diagnostics.calls.length} of 3 model calls used
      </p>
      <p>
        Checks detect specific assertion and duplication problems. A QE still
        confirms that each expected result matches the business requirement.
      </p>
      {job.diagnostics.failure && (
        <p role="status">
          Stopped at {job.diagnostics.stoppedAt}:{" "}
          {job.diagnostics.failure.replaceAll("-", " ")}
        </p>
      )}
      {job.quality?.map((quality, index) => (
        <details key={index} open={quality.status === "blocked"}>
          <summary>
            Proposal {index + 1} ·{" "}
            {quality.status === "blocked"
              ? "Fix before staging"
              : "Needs QE review"}{" "}
            · {quality.assertions} assertions
          </summary>
          <p>{job.proposals?.[index]?.title ?? "Proposal checks"}</p>
          {quality.findings.length ? (
            <ul>
              {quality.findings.map((f, i) => (
                <li key={i}>
                  <strong>
                    {f.severity === "blocker" ? "Fix" : "Review"}
                    {f.step ? ` · step ${f.step}` : ""}:
                  </strong>{" "}
                  {f.detail}
                  {f.relatedCandidateId && (
                    <small> Related: {f.relatedCandidateId}</small>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No configured lint rules flagged this proposal. This does not
              establish correct or complete coverage.
            </p>
          )}
        </details>
      ))}
      {job.resolvedModels?.map((m, i) => (
        <p key={i}>
          {m.role}: verified local {m.name} · digest {m.digest.slice(0, 16)} ·
          cloud disabled
        </p>
      ))}
      <details>
        <summary>Model call diagnostics</summary>
        <ul>
          {job.diagnostics.calls.map((call, i) => (
            <li key={i}>
              {call.role}: {call.outcome} · {call.durationMs} ms ·{" "}
              {call.promptBytes.toLocaleString()} input bytes
              {call.outputBytes !== undefined
                ? ` · ${call.outputBytes.toLocaleString()} output bytes`
                : ""}
            </li>
          ))}
        </ul>
        <p>
          Sizes measure serialized text, not tokens or billing. Local inference
          still uses your machine's resources.
        </p>
      </details>
      <button
        className="button"
        onClick={download}
        disabled={job.state === "running"}
      >
        Export AI review diagnostics
      </button>
      <p className="muted">
        Exports check codes, counts and fingerprints. Source excerpts, proposal
        values and raw prompts are excluded.
      </p>
    </section>
  );
}
