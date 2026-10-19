import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateProject } from "../src/model.js";
import { createReport } from "../src/reporting.js";
import {
  emailDraftURL,
  emailSummary,
  resultNextStep,
  runOutcome,
  type StudioRun,
} from "../src/run-summary.js";
const project = validateProject(
  JSON.parse(await readFile("examples/project.json", "utf8")),
);
function run(): StudioRun {
  const report = createReport(project, "local", "smoke", [
    {
      profile: "local",
      provider: "local",
      browser: "chromium",
      results: [{ id: "TC-API", status: "passed", durationMs: 1 }],
    },
  ]);
  report.gates = [];
  return { id: "job-123", at: report.at, state: "completed", report };
}
test("outcomes distinguish completed checks, drafts, blockers, retries and incomplete runs", () => {
  const r = run();
  assert.equal(runOutcome(r).label, "Tests passed");
  r.draftValidation = true;
  assert.equal(runOutcome(r).label, "Trial passed");
  for (const key of [
    "failed",
    "blocked",
    "skipped",
    "flaky",
    "healed",
  ] as const) {
    const changed = run();
    changed.report!.summary[key] = 1;
    assert.equal(runOutcome(changed).label, "Needs attention");
  }
  r.report!.summary.total = 0;
  assert.equal(runOutcome(r).label, "Needs attention");
  r.state = "running";
  assert.equal(runOutcome(r).label, "In progress");
  assert.throws(() => emailSummary(r));
  r.state = "failed";
  assert.equal(runOutcome(r).label, "Could not finish");
  assert.throws(() => emailSummary(r));
  const result = run().report!.results[0]!;
  assert.match(
    resultNextStep({ ...result, status: "blocked" }),
    /prerequisite/,
  );
  assert.match(resultNextStep({ ...result, flaky: true }), /retry/);
});
test("email summary excludes raw evidence and mailto preserves text without header injection", () => {
  const r = run();
  r.report!.results[0]!.title = "private title";
  r.report!.results[0]!.reason = "secret-token";
  const summary = emailSummary(r);
  assert.ok(summary.body.includes("job-123"));
  assert.ok(!summary.body.includes("private title"));
  assert.ok(!summary.body.includes("secret-token"));
  assert.match(summary.body, /Production readiness is not assessed/);
  const url = new URL(
    emailDraftURL(
      "qe@example.com; lead@example.com",
      "Review & verify",
      "Line 1\nLine 2 & details",
    ),
  );
  assert.equal(url.searchParams.get("subject"), "Review & verify");
  assert.equal(url.searchParams.get("body"), "Line 1\nLine 2 & details");
  for (const bad of [
    "",
    "qe@example.com\r\nBcc:evil@example.com",
    "qe@example.com?bcc=evil@example.com",
  ])
    assert.throws(() => emailDraftURL(bad, "Test", "Summary"));
  assert.throws(() =>
    emailDraftURL("qe@example.com", "Test\nBcc:evil@example.com", "Summary"),
  );
  assert.throws(() =>
    emailDraftURL("qe@example.com", "Test", "x".repeat(8001)),
  );
});
