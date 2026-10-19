import type { WorkspaceState } from "./workspace-server.js";
export type StudioRun = WorkspaceState["runs"][number];
export function runOutcome(run: StudioRun) {
  if (run.state === "running")
    return {
      label: "In progress",
      tone: "blue",
      next: "Tests are running. Results appear when execution and cleanup finish.",
    };
  if (run.state === "failed" || !run.report)
    return {
      label: "Could not finish",
      tone: "red",
      next: "Check the run error and environment setup, then try again. No completed results are available.",
    };
  const s = run.report.summary;
  if (
    s.failed ||
    s.blocked ||
    s.skipped ||
    !s.total ||
    run.report.gates.length ||
    s.flaky ||
    s.healed
  )
    return {
      label: "Needs attention",
      tone: "amber",
      next: "Review failures and tests that could not run. Resolve prerequisites and quality checks before relying on this result.",
    };
  return {
    label: run.draftValidation ? "Trial passed" : "Tests passed",
    tone: "green",
    next: run.draftValidation
      ? "Review the generated tests before using them as approved coverage."
      : "The selected tests passed. Check remaining coverage and release requirements separately.",
  };
}
export function resultNextStep(
  result: NonNullable<StudioRun["report"]>["results"][number],
) {
  if (result.healed)
    return "Review the proposed control repair, then rerun the unchanged expected result.";
  if (result.flaky)
    return "This test needed a retry. Inspect the earlier failure and rerun to check reliability.";
  if (result.status === "blocked")
    return "Resolve the prerequisite, account, or test-data blocker, then run again.";
  if (result.status === "skipped")
    return "Check the test review status and run selection to find why it did not run.";
  if (result.status === "failed")
    return "Compare the failed step with the expected result. Confirm whether the application or test needs a change.";
  return "The checks passed in this run.";
}
/** Deliberately omit test names, raw errors, application URLs, source excerpts and traces. */
export function emailSummary(run: StudioRun) {
  if (run.state !== "completed" || !run.report)
    throw new Error("Finish the run before sharing its result");
  const s = run.report.summary,
    outcome = runOutcome(run);
  return {
    subject: `SuperQ test results: ${outcome.label}`,
    body: [
      "SuperQ test result summary",
      `Outcome: ${outcome.label}`,
      `Run ID: ${run.id}`,
      `Completed report: ${run.report.at}`,
      `Scope: ${run.draftValidation ? "Draft trial (not approved coverage)" : "Selected test execution"}`,
      "",
      `Test executions: ${s.total}`,
      `Passed: ${s.passed}`,
      `Failed: ${s.failed}`,
      `Blocked: ${s.blocked}`,
      `Not run: ${s.skipped}`,
      `Passed after retry: ${s.flaky}`,
      `Automatic repairs requiring review: ${s.healed}`,
      `Quality checks needing attention: ${run.report.gates.length}`,
      "",
      outcome.next,
      "Production readiness is not assessed by this summary.",
      "",
      "Download and attach the full report if your recipients need details. Review its contents before sharing. Local Studio links will not work on another computer.",
    ].join("\n"),
  };
}
export function emailDraftURL(
  recipients: string,
  subject: string,
  body: string,
) {
  const addresses = recipients
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    !addresses.length ||
    addresses.length > 20 ||
    addresses.some(
      (x) =>
        !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(
          x,
        ),
    )
  )
    throw new Error("Enter email addresses separated by commas (up to 20).");
  if (/[\r\n]/.test(subject) || subject.length > 200)
    throw new Error("Use a single-line subject of up to 200 characters.");
  if (body.length > 8000)
    throw new Error("Keep the email summary under 8,000 characters.");
  return `mailto:${addresses.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
