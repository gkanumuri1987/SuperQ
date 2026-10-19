import AIReview from "./AIReview";
import SetupFlows from "./SetupFlows";
import { useState } from "react";
import type { WorkspaceState } from "../src/workspace-server";
import type { Recording } from "../src/recorder";
type Active = Recording & { candidateId: string };
export default function Assistance({
  state,
  recording,
  action,
}: {
  state: WorkspaceState;
  recording: Active | null;
  action: (path: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [model, setModel] = useState(""),
    [path, setPath] = useState("/"),
    [candidate, setCandidate] = useState(""),
    [locator, setLocator] = useState(""),
    [expected, setExpected] = useState(""),
    [strategy, setStrategy] = useState("testId"),
    [pending, setPending] = useState(false),
    [user, setUser] = useState(""),
    [anonymous, setAnonymous] = useState(false);
  const plan = state.intake,
    job = state.coordination;
  const act = async (p: string, b: Record<string, unknown>) => {
    setPending(true);
    try {
      return await action(p, b);
    } finally {
      setPending(false);
    }
  };
  if (!plan || plan.generated) return null;
  return (
    <section className="automate-card">
      <h2>Capture a flow or ask your local agents</h2>
      <p>Optional help. Every result returns to the same plan for QE review.</p>
      <details open={!!recording}>
        <summary>Record a web flow</summary>
        <p>
          A local Chromium window opens. Use synthetic data. Entered values
          become placeholders; passwords and unsupported controls are skipped.
          This recorder supports main-page forms, buttons and links. Review
          navigation, frames, custom widgets and every expected result.
        </p>
        {!recording ? (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void act("recorder/start", {
                candidateId: candidate || plan.candidates[0]?.id,
                path,
                ...(user ? { user } : {}),
                anonymous,
              });
            }}
          >
            <label>
              Case to record
              <select
                value={candidate || plan.candidates[0]?.id || ""}
                onChange={(e) => setCandidate(e.target.value)}
              >
                {plan.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Recording account
              <select
                aria-label="Recording account"
                value={user}
                disabled={anonymous}
                onChange={(e) => setUser(e.target.value)}
              >
                <option value="">Use case role / environment default</option>
                {Object.entries(
                  state.project.environments[plan.environment]?.users ?? {},
                ).map(([id, u]) => (
                  <option value={id} key={id}>
                    {id} ({u.role})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
              />
              Record without authentication
            </label>
            <p>
              Configured form login/MFA or a current saved SSO session is
              verified before capture begins. Complete SSO sign-in in
              Environments & accounts first. Credentials and sign-in steps are
              excluded from the draft.
            </p>
            <label>
              Starting application path
              <input
                required
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </label>
            <button
              className="button"
              disabled={
                pending || job?.state === "running" || !plan.candidates.length
              }
            >
              Open recording browser
            </button>
          </form>
        ) : (
          <>
            <p>
              {recording.closed
                ? "Browser closed. Captured steps remain available for review."
                : `Recording ${recording.commands.length} steps. Complete the flow in the opened browser.`}
            </p>
            {recording.notices.map((n) => (
              <p role="status" key={n}>
                {n}
              </p>
            ))}
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void act("recorder/assert", {
                  command: {
                    type: "expectText",
                    locator: { strategy, value: locator },
                    value: expected,
                  },
                });
              }}
            >
              <p>
                Add an expected result from the requirement. Recording observed
                content alone does not prove correctness.
              </p>
              <label>
                Expected result locator type
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                >
                  <option value="testId">Test ID</option>
                  <option value="label">Label</option>
                  <option value="text">Exact text</option>
                </select>
              </label>
              <label>
                Expected result locator
                <input
                  required
                  value={locator}
                  onChange={(e) => setLocator(e.target.value)}
                />
              </label>
              <label>
                Expected text
                <input
                  required
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                />
              </label>
              <button className="button" disabled={pending || recording.closed}>
                Add expected result
              </button>
            </form>
            <details>
              <summary>Captured steps</summary>
              <pre>{JSON.stringify(recording.commands, null, 2)}</pre>
            </details>
            <button
              className="button primary"
              disabled={
                pending ||
                !recording.commands.some((c) => c.type.startsWith("expect"))
              }
              onClick={() => void act("recorder/finish", {})}
            >
              Save recording as draft
            </button>{" "}
            <button
              className="button"
              disabled={pending}
              onClick={() => void act("recorder/cancel", {})}
            >
              Discard recording
            </button>
            <p>
              After saving, open “Map actions & assertions” to replace
              recorded.field placeholders with configured test-data variables.
            </p>
          </>
        )}
      </details>
      <SetupFlows
        state={state}
        disabled={pending || !!recording || job?.state === "running"}
        action={action}
      />
      <details open={job?.state === "running"}>
        <summary>Three-agent coverage review · local Ollama</summary>
        <p>
          Analyst → test designer → independent reviewer. At most three local
          model calls, 4,000 output tokens per call, three-minute deadline. No
          downloads, paid fallback, shell tools or automatic execution. The same
          installed model runs separate scoped roles; agreement does not certify
          accuracy.
        </p>
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void act("coordination/start", { model });
          }}
        >
          <label>
            Installed local Ollama model
            <input
              required
              placeholder="Your installed model name"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <button
            className="button"
            disabled={pending || !!recording || job?.state === "running"}
          >
            Review coverage with local agents
          </button>
        </form>
        {job && (
          <div aria-live="polite">
            <p>
              <strong>Coordination: {job.state}</strong> · {job.model}
            </p>
            {job.roles.map((r) => (
              <p key={r.role}>
                {r.role}: {r.state}
              </p>
            ))}
            {job.error && <p>{job.error}</p>}
            <AIReview job={job} />
            {job.analysis?.questions.map((q, i) => (
              <p key={i}>{q}</p>
            ))}
            {job.review?.issues.map((q, i) => (
              <p key={i}>{q}</p>
            ))}
            {job.proposals && (
              <details>
                <summary>
                  {job.proposals.length} proposed cases · inspect evidence and
                  steps
                </summary>
                {job.proposals.map((p, i) => (
                  <article key={i}>
                    <h3>{p.title}</h3>
                    {p.steps.map((s, j) => (
                      <p key={j}>
                        {s.action} → {s.expected}
                      </p>
                    ))}
                    {p.evidence.map((e, j) => (
                      <p key={j}>
                        {e.source} · {e.revision}: {e.excerpt}
                      </p>
                    ))}
                  </article>
                ))}
              </details>
            )}
            {job.state === "running" && (
              <button
                className="button"
                onClick={() => void act("coordination/cancel", {})}
              >
                Cancel agent work
              </button>
            )}
            {job.state === "completed" && (
              <button
                className="button"
                disabled={
                  pending ||
                  !!job.review?.issues.length ||
                  !job.review?.accepted.length
                }
                onClick={() => void act("coordination/apply", {})}
              >
                Stage accepted proposals for QE review
              </button>
            )}
          </div>
        )}
      </details>
    </section>
  );
}
