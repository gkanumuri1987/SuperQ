import { useState } from "react";
import {
  emailDraftURL,
  emailSummary,
  resultNextStep,
  runOutcome,
  type StudioRun,
} from "../src/run-summary";
import "./results.css";
type Props = {
  runs: StudioRun[];
  openTest: (id: string) => void;
  downloadTrace: (id: string) => void;
  deleteTrace: (id: string) => void;
};
export default function ResultsCenter({
  runs,
  openTest,
  downloadTrace,
  deleteTrace,
}: Props) {
  const [selected, setSelected] = useState<string | undefined>();
  const run = runs.find((r) => r.id === selected) ?? runs[0];
  if (!run) return null;
  return (
    <div className="results-center">
      <label className="results-run-picker">
        Choose a run
        <select value={run.id} onChange={(e) => setSelected(e.target.value)}>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {new Date(r.at).toLocaleString()} ·{" "}
              {r.configuration?.environment ?? r.report?.environment ?? "Run"} ·{" "}
              {r.configuration?.suite ?? r.report?.suite ?? "Tests"} ·{" "}
              {runOutcome(r).label}
            </option>
          ))}
        </select>
      </label>
      <RunDetail
        key={run.id}
        run={run}
        openTest={openTest}
        downloadTrace={downloadTrace}
        deleteTrace={deleteTrace}
      />
    </div>
  );
}
function RunDetail({
  run,
  openTest,
  downloadTrace,
  deleteTrace,
}: Omit<Props, "runs"> & { run: StudioRun }) {
  const [filter, setFilter] = useState("attention"),
    [search, setSearch] = useState(""),
    [sharing, setSharing] = useState(false);
  const outcome = runOutcome(run),
    report = run.state === "completed" ? run.report : undefined;
  const results = report?.results ?? [];
  const attention = results.filter(
    (r) => r.status !== "passed" || r.flaky || r.healed,
  );
  const shown = results.filter(
    (r) =>
      (filter === "all" || filter === "attention"
        ? filter === "all" || r.status !== "passed" || r.flaky || r.healed
        : r.status === filter) &&
      `${r.title} ${r.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <section
        className={`results-outcome ${outcome.tone}`}
        aria-label="Run outcome"
        aria-live="polite"
      >
        <div>
          <span className="eyebrow">
            {run.draftValidation
              ? "Practice run · draft tests"
              : "Test execution"}
          </span>
          <h2>{outcome.label}</h2>
          <p>{outcome.next}</p>
        </div>
        <p>
          {run.configuration?.environment ?? report?.environment} ·{" "}
          {run.configuration?.profile ??
            report?.runs.map((r) => r.profile).join(", ")}
          <br />
          {new Date(run.at).toLocaleString()}
        </p>
      </section>
      {run.error && (
        <p role="alert" className="intake-blocker">
          {run.error}
        </p>
      )}
      {report && (
        <>
          <section className="result-counts" aria-label="Test execution totals">
            {(
              [
                ["passed", "Passed"],
                ["failed", "Failed"],
                ["blocked", "Blocked"],
                ["skipped", "Not run"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                <strong>{report.summary[key]}</strong>
                {label}
              </button>
            ))}
          </section>
          <div className="result-share-actions">
            <button className="button" onClick={() => setSharing(!sharing)}>
              Email summary
            </button>
            <a
              className="button"
              href={`/api/reports/${run.id}/html`}
              download={`superq-${run.id}.html`}
            >
              Download full report
            </a>
            <a
              className="button"
              href={`/api/reports/${run.id}/html`}
              target="_blank"
              rel="noreferrer"
            >
              Open report
            </a>
          </div>
          {sharing && <EmailComposer run={run} />}
          <section className="card result-list" aria-label="Test results">
            <h2>
              {attention.length
                ? `${attention.length} results need attention`
                : results.length
                  ? "No test failures or blockers"
                  : "No tests executed"}
            </h2>
            <div className="result-filters">
              <label>
                Show results
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="attention">Needs attention</option>
                  <option value="all">All tests</option>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                  <option value="blocked">Blocked</option>
                  <option value="skipped">Not run</option>
                </select>
              </label>
              <label>
                Find a test
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Test name or ID"
                />
              </label>
            </div>
            {!shown.length && (
              <p>
                {attention.length === 0 && filter === "attention"
                  ? !report.results.length
                    ? "No tests executed in this run. Check the run selection and quality requirements below."
                    : "All executed checks passed without a retry or automatic repair. Use All tests to see each result; check quality requirements below."
                  : "No tests match this view."}
              </p>
            )}
            {shown.map((r, i) => (
              <article
                className="tester-result"
                key={`${r.profile}:${r.id}:${i}`}
              >
                <div>
                  <h3>{r.title}</h3>
                  <span>
                    {r.status === "skipped" ? "Not run" : r.status}{" "}
                    {r.flaky ? "· Passed after retry" : ""}{" "}
                    {r.healed ? "· Repair needs review" : ""}
                  </span>
                </div>
                <p className="result-context">
                  {r.profile} · {(r.durationMs / 1000).toFixed(1)} seconds ·{" "}
                  {r.attempts?.length ?? 1} attempt(s)
                </p>
                {r.reason && <p>{r.reason}</p>}
                <p>
                  <strong>Next step:</strong> {resultNextStep(r)}
                </p>
                {!!r.observations?.some((o) => o.status === "failed") && (
                  <details>
                    <summary>Which step needs attention?</summary>
                    {r.observations
                      .filter((o) => o.status === "failed")
                      .map((o, j) => (
                        <p key={j}>
                          Step {o.step}
                          {o.command ? `, action ${o.command}` : ""}:{" "}
                          {o.issue ?? o.operation}
                          {o.assertionPath ? ` (${o.assertionPath})` : ""}
                        </p>
                      ))}
                  </details>
                )}
                {r.flaky && <p>Earlier failures remain in the full report.</p>}
                <button className="button" onClick={() => openTest(r.id)}>
                  Review this test
                </button>
              </article>
            ))}
          </section>
          <details className="card result-evidence">
            <summary>Coverage & quality checks</summary>
            <p>
              These figures cover the configured requirements and selected
              execution, not every possible application behavior.
            </p>
            <p>{report.gates.length} quality checks need attention.</p>
            {report.gates.map((g, i) => (
              <p key={i}>{g}</p>
            ))}
            <p>
              Risk-weighted automated coverage:{" "}
              {(report.coverage.riskWeightedAutomation * 100).toFixed(0)}%.
              Draft trials do not approve coverage.
            </p>
          </details>
        </>
      )}
      {run.traceWarnings?.map((w, i) => (
        <p key={i}>{w}</p>
      ))}
      {!!run.traces?.length && (
        <details className="card result-evidence">
          <summary>Technical evidence · private traces</summary>
          <p>
            Traces can contain screenshots, application data and credentials.
            They expire after 24 hours and are not included in the email
            summary.
          </p>
          {run.traces.map((t) => (
            <div key={t.id}>
              <button className="button" onClick={() => downloadTrace(t.id)}>
                {t.testId} · attempt {t.attempt} · Download trace
              </button>
              <button className="button" onClick={() => deleteTrace(t.id)}>
                Delete trace
              </button>
            </div>
          ))}
        </details>
      )}
    </>
  );
}
function EmailComposer({ run }: { run: StudioRun }) {
  const initial = emailSummary(run),
    [to, setTo] = useState(""),
    [subject, setSubject] = useState(initial.subject),
    [body, setBody] = useState(initial.body),
    [error, setError] = useState("");
  let href: string | undefined;
  try {
    href = emailDraftURL(to, subject, body);
  } catch {}
  return (
    <section className="card email-composer" aria-label="Email report summary">
      <h2>Review your email summary</h2>
      <p>
        Review the summary, then open it in your email app. You choose when to
        send. Attach the downloaded full report if needed.
      </p>
      <label>
        Recipients
        <input
          type="text"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setError("");
          }}
          placeholder="qe-team@example.com, lead@example.com"
        />
      </label>
      <label>
        Email subject
        <input
          value={subject}
          maxLength={200}
          onChange={(e) => {
            setSubject(e.target.value);
            setError("");
          }}
        />
      </label>
      <label>
        Email message
        <textarea
          rows={12}
          value={body}
          maxLength={8000}
          onChange={(e) => {
            setBody(e.target.value);
            setError("");
          }}
        />
      </label>
      {href ? (
        <a className="button primary" href={href}>
          Open email draft
        </a>
      ) : (
        <button
          className="button"
          onClick={() => {
            try {
              emailDraftURL(to, subject, body);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Open email draft
        </button>
      )}
      <button
        className="button"
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob([`Subject: ${subject}\n\n${body}`], {
              type: "text/plain",
            }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = `superq-summary-${run.id}.txt`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        Download summary text
      </button>
      {error && <p role="alert">{error}</p>}
      <p className="result-context">
        The default summary excludes test names, raw errors, URLs, traces and
        test data. No email is sent or recipient address stored by SuperQ.
      </p>
    </section>
  );
}
