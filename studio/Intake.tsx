import { useState } from "react";
import type { WorkspaceState } from "../src/workspace-server";
import type { Candidate, IntakePlan, Recipe } from "../src/intake";
import type { preflight } from "../src/intake";
import "./automate.css";
import "./intake.css";
type Props = {
  state: WorkspaceState;
  status: {
    plan: IntakePlan | null;
    stale: boolean;
    blockers: ReturnType<typeof preflight>;
  };
  agent: { enabled: boolean; allowTrials: boolean; file: string | null };
  action: (path: string, body: Record<string, unknown>) => Promise<boolean>;
  go: (page: string) => void;
};
export default function Intake({ state, status, agent, action, go }: Props) {
  const [environment, setEnvironment] = useState(
    Object.keys(state.project.environments)[0] ?? "",
  );
  const [preference, setPreference] = useState<"api" | "web">("web");
  const [reviewer, setReviewer] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [manual, setManual] = useState("");
  const [source, setSource] = useState("Manual upload");
  const [revision, setRevision] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [error, setError] = useState("");
  const plan = status.plan;
  const act = async (path: string, body: Record<string, unknown>) => {
    setPending(true);
    setError("");
    try {
      return await action(path, body);
    } finally {
      setPending(false);
    }
  };
  const job = plan?.generated
    ? state.runs.find(
        (r) =>
          r.report?.results.some((t) =>
            plan.generated!.testIds.includes(t.id),
          ) || r.state === "running",
      )
    : undefined;
  return (
    <div className="intake-home automate-home">
      <div className="automate-intro">
        <span className="eyebrow">GUIDED AUTOMATION</span>
        <h1>Start with what you have.</h1>
        <p>
          Connect source evidence, review a clear plan, then try the automation.
          Your QE stays in control of scope and expected results.
        </p>
      </div>
      <div className="intake-progress" aria-label="Workflow stages">
        <span>1 · Sources</span>
        <span>2 · Plan & review</span>
        <span>3 · Automate & verify</span>
      </div>
      <section className="automate-card">
        <h2>
          <span>1</span> Your starting point
        </h2>
        <div className="intake-source-grid">
          <div>
            <strong>Application repository</strong>
            <p>
              {state.sourceSnapshot
                ? `${state.sourceSnapshot.files.length} committed files · ${state.sourceSnapshot.revision.slice(0, 8)}`
                : "No repository knowledge scanned yet"}
            </p>
            <button className="button" onClick={() => go("connections")}>
              Configure repository
            </button>
            {state.connections.localRepository && (
              <button
                className="button"
                disabled={pending}
                onClick={() => void act("scan", {})}
              >
                Scan allowed files
              </button>
            )}
          </div>
          <div>
            <strong>Manual test inventory</strong>
            <p>{state.planning?.cases.length ?? 0} imported manual cases</p>
            <button className="button" onClick={() => setImporting(!importing)}>
              Add manual cases
            </button>{" "}
            <button className="button" onClick={() => go("planning")}>
              Tracker / sprint intake
            </button>
          </div>
        </div>
        <p className="automate-note">
          Repo only: propose scenarios from Gherkin and OpenAPI JSON. Inventory
          only: check scope and prerequisites. Both: reconcile candidates and
          flag coverage questions. A linked URL alone does not supply repository
          content.
        </p>
        {importing && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                const cases = new Map<
                  string,
                  {
                    source: string;
                    externalId: string;
                    revision: string;
                    title: string;
                    featureIds: string[];
                    storyIds: string[];
                    steps: { action: string; expected: string }[];
                    dependsOn: string[];
                  }
                >();
                for (const [n, line] of manual.split(/\r?\n/).entries()) {
                  if (!line.trim()) continue;
                  const values = line.split("\t").map((s) => s.trim());
                  if (values.length !== 4 || values.some((s) => !s))
                    throw new Error(
                      `Row ${n + 1}: use four tab-separated columns: ID, title, action, expected result.`,
                    );
                  const [id, title, step, expected] = values as [
                    string,
                    string,
                    string,
                    string,
                  ];
                  if (cases.has(id) && cases.get(id)!.title !== title)
                    throw new Error(
                      `Row ${n + 1}: keep the same title for all steps of ${id}.`,
                    );
                  const c = cases.get(id) ?? {
                    source,
                    externalId: id,
                    revision,
                    title,
                    featureIds: ["manual-current-scope"],
                    storyIds: [],
                    steps: [],
                    dependsOn: [],
                  };
                  c.steps.push({ action: step, expected });
                  cases.set(id, c);
                }
                if (!cases.size || !source.trim() || !revision.trim())
                  throw new Error(
                    "Provide a source, revision and at least one manual test.",
                  );
                const previous = state.planning;
                const imported = [...cases.values()];
                const planning = {
                  team: previous?.team ?? "",
                  sprint: previous?.sprint ?? "",
                  stories: previous?.stories ?? [],
                  documents: previous?.documents ?? [],
                  features: [
                    ...(previous?.features ?? []).filter(
                      (f) => f.id !== "manual-current-scope",
                    ),
                    {
                      id: "manual-current-scope",
                      title: "QE selected manual scope",
                      module: "Manual intake",
                      lifecycle: "active",
                      evidence: {
                        source,
                        revision,
                        excerpt:
                          "QE explicitly imported these cases as current scope; confirm lifecycle during review.",
                      },
                    },
                  ],
                  cases: [
                    ...(previous?.cases ?? []).filter(
                      (c) =>
                        !imported.some(
                          (i) =>
                            i.source === c.source &&
                            i.externalId === c.externalId,
                        ),
                    ),
                    ...imported,
                  ],
                };
                if (await act("planning", { planning })) {
                  setImporting(false);
                  setManual("");
                }
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <div className="automate-field-row">
              <label>
                Inventory source
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  required
                />
              </label>
              <label>
                Source revision
                <input
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                  required
                />
              </label>
            </div>
            <label>
              Paste rows from your spreadsheet
              <textarea
                rows={6}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder={
                  "TC-1\tHealth status\tRequest GET /api/health\tResponse status is ok"
                }
              />
              <small>
                Four columns, no header: ID, title, action, expected result.
                Repeat the ID for more steps. This imports cases into the QE
                selected current scope. Use sprint intake to supply feature
                lifecycle, dependencies and tracker revisions.
              </small>
            </label>
            <button className="button primary" disabled={pending}>
              Import current-scope cases
            </button>
          </form>
        )}
        <div className="automate-field-row">
          <label>
            Test environment
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
            >
              {Object.keys(state.project.environments).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            Automation preference
            <select
              value={preference}
              onChange={(e) => setPreference(e.target.value as "api" | "web")}
            >
              <option value="web">Web application</option>
              <option value="api">API</option>
            </select>
          </label>
        </div>
        <button
          className="button primary"
          disabled={
            pending ||
            (!state.sourceSnapshot?.files.length &&
              !state.planning?.cases.length &&
              !state.project.requirements.some((r) => r.criteria.length))
          }
          onClick={() => {
            setAcknowledge(false);
            void act("intake/analyze", { environment, preference });
          }}
        >
          Analyze & prepare review plan
        </button>
      </section>
      {error && (
        <p className="automate-error" role="alert">
          {error}
        </p>
      )}
      {plan && (
        <section className="automate-card intake-section">
          <h2>
            <span>2</span> Review your automation plan
          </h2>
          <p>
            <strong>{plan.mode} intake</strong> ·{" "}
            {plan.preference === "web" ? "Web application" : "API"} ·{" "}
            {plan.environment} ·{" "}
            {plan.candidates.filter((c) => c.selected).length} selected
          </p>
          {status.stale && (
            <p className="automate-error" role="alert">
              Sources, tests or configuration changed. Analyze again before
              continuing this plan. Existing drafts remain in your library.
            </p>
          )}
          <details>
            <summary>What this analysis can and cannot establish</summary>
            {plan.questions.map((q, i) => (
              <p key={i}>{q}</p>
            ))}
          </details>
          {!plan.candidates.length && (
            <p>
              No supported scenarios found. Import manual cases or scan .feature
              / OpenAPI JSON files. Other source files remain available to your
              coding agent for grounded proposals.
            </p>
          )}
          {plan.candidates.map((c) => (
            <article className="intake-candidate" key={c.id}>
              <div className="intake-candidate-heading">
                <label className="intake-check">
                  <input
                    type="checkbox"
                    aria-label={`Include ${c.title}`}
                    checked={c.selected}
                    disabled={pending || status.stale || !!plan.generated}
                    onChange={(e) => {
                      setAcknowledge(false);
                      void act("intake/map", {
                        candidateId: c.id,
                        patch: { selected: e.target.checked },
                      });
                    }}
                  />
                  <strong>{c.title}</strong>
                </label>
                <span
                  className={`intake-badge ${c.disposition === "current" ? "current" : ""}`}
                >
                  {c.disposition}
                </span>
              </div>
              <p className="automate-note">
                {c.id} · {c.dependsOn.length} prerequisites ·{" "}
                {c.recipe
                  ? "Executable mapping proposed"
                  : "Needs action mapping"}
              </p>
              {c.existingTestIds.length > 0 && (
                <p>
                  {c.targetTestId
                    ? "Enhance existing manual case"
                    : "Reuse existing tests"}
                  : {c.existingTestIds.join(", ")}
                </p>
              )}
              <details>
                <summary>Steps, expectations & source evidence</summary>
                <ol>
                  {c.steps.map((s, i) => (
                    <li key={i}>
                      <strong>{s.action}</strong>
                      <p>Expect: {s.expected}</p>
                    </li>
                  ))}
                </ol>
                {c.evidence.map((e, i) => (
                  <div key={i}>
                    <p>
                      <strong>{e.source}</strong> · {e.revision}
                    </p>
                    <pre>{e.excerpt}</pre>
                  </div>
                ))}
                {c.questions.map((q, i) => (
                  <p key={i}>{q}</p>
                ))}
              </details>
              {c.recipe && (
                <details>
                  <summary>Proposed automation actions & assertions</summary>
                  <RecipeSummary recipe={c.recipe} />
                </details>
              )}
              {!plan.generated && !status.stale && (
                <button
                  className="button"
                  disabled={pending}
                  onClick={() => setEdit(edit === c.id ? null : c.id)}
                >
                  {edit === c.id ? "Close mapping" : "Map actions & assertions"}
                </button>
              )}
              {edit === c.id && !plan.generated && !status.stale && (
                <Mapping
                  key={c.id}
                  candidate={c}
                  kind={plan.preference}
                  roles={Object.keys(state.project.roles ?? {})}
                  accounts={
                    state.project.environments[plan.environment]?.users ?? {}
                  }
                  save={async (patch) => {
                    setAcknowledge(false);
                    if (await act("intake/map", { candidateId: c.id, patch }))
                      setEdit(null);
                  }}
                />
              )}
              {status.blockers
                .filter((b) => b.candidateId === c.id)
                .map((b, i) => (
                  <p key={i} className="intake-blocker">
                    <strong>
                      {b.kind}: {b.detail}
                    </strong>
                    <br />
                    {b.resolution}
                  </p>
                ))}
            </article>
          ))}
          {status.blockers
            .filter((b) => b.candidateId === "plan")
            .map((b, i) => (
              <p className="intake-blocker" key={i}>
                {b.detail} · {b.resolution}
              </p>
            ))}
          {!plan.generated && (
            <>
              <label>
                QE reviewer
                <input
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label className="intake-check">
                <input
                  type="checkbox"
                  checked={acknowledge}
                  onChange={(e) => setAcknowledge(e.target.checked)}
                />
                I reviewed scope, expected results, prerequisites and
                test-environment side effects.
              </label>
              <div className="automate-actions">
                <button
                  className="button"
                  disabled={
                    pending ||
                    status.stale ||
                    !!status.blockers.length ||
                    !reviewer.trim() ||
                    !acknowledge
                  }
                  onClick={() => void act("intake/review", { reviewer })}
                >
                  Approve plan for automation
                </button>
                <button
                  className="button primary"
                  disabled={
                    pending ||
                    status.stale ||
                    !plan.review ||
                    !!status.blockers.length
                  }
                  onClick={() => void act("intake/generate", {})}
                >
                  Generate reviewed automation
                </button>
              </div>
            </>
          )}
          {plan.review && (
            <p className="automate-note">
              Plan reviewed by {plan.review.reviewer} ·{" "}
              {new Date(plan.review.at).toLocaleString()}. This approves the
              mapping; generated tests remain drafts until verified and
              reviewed.
            </p>
          )}
        </section>
      )}
      {plan?.generated && (
        <section className="automate-card intake-section">
          <h2>
            <span>3</span> Verify in the application
          </h2>
          <p>
            {plan.generated.testIds.length} reusable draft tests created. The
            trial navigates configured web flows or sends API requests and
            evaluates every assertion. Failed commands, account problems and
            prerequisite failures remain visible.
          </p>
          <div className="automate-actions">
            <button
              className="button primary"
              disabled={
                pending ||
                status.stale ||
                state.runs.some((r) => r.state === "running")
              }
              onClick={() => void act("intake/trial", {})}
            >
              Run local draft trial
            </button>
            <button className="button" onClick={() => go("tests")}>
              Review generated tests
            </button>
            <button className="button" onClick={() => go("runs")}>
              Reports & blockers
            </button>
          </div>
          {job && (
            <div className="automate-result">
              <strong>Trial: {job.state}</strong>
              {job.error && <p>{job.error}</p>}
              {job.report?.results.map((r) => (
                <div key={r.id}>
                  <p>
                    <strong>
                      {r.title}: {r.status}
                    </strong>
                    {r.reason && ` · ${r.reason}`}
                  </p>
                  {r.observations
                    ?.filter((o) => o.status === "failed")
                    .map((o, i) => (
                      <p key={`observation-${i}`}>
                        Step {o.step}
                        {o.command ? `, command ${o.command}` : ""}:{" "}
                        {o.issue ?? o.operation}
                        {o.locator ? ` · locator ${o.locator}` : ""}
                        {o.assertionPath ? ` · ${o.assertionPath}` : ""}
                      </p>
                    ))}
                  {r.attempts
                    ?.filter((a) => a.failedStep)
                    .map((a) => (
                      <p key={a.number}>
                        Attempt {a.number}, step {a.failedStep}: {a.failureKind}
                      </p>
                    ))}
                </div>
              ))}
            </div>
          )}
          <p className="automate-note">
            Trials can change test-environment data. They do not approve tests,
            count as release proof or certify a production promotion.
          </p>
        </section>
      )}
      <section className="automate-card intake-section">
        <h2>Work with your corporate coding agent</h2>
        <p>
          Share committed sources, manual steps, plan mappings and trial
          diagnostics with an MCP-capable host such as Copilot. Your
          organization's policies and the host's own model access apply.
        </p>
        <div className="automate-actions">
          <button
            className="button"
            disabled={pending}
            onClick={() =>
              void act("agent-access", {
                enabled: !agent.enabled,
                allowTrials: false,
              })
            }
          >
            {agent.enabled
              ? "Revoke agent connection"
              : "Enable proposal-only MCP connection"}
          </button>
          {agent.enabled && (
            <button
              className="button"
              disabled={pending}
              onClick={() =>
                void act("agent-access", {
                  enabled: true,
                  allowTrials: !agent.allowTrials,
                })
              }
            >
              {agent.allowTrials
                ? "Disable agent trials"
                : "Allow reviewed local trials"}
            </button>
          )}
        </div>
        {agent.enabled && (
          <>
            <p>
              <strong>
                {agent.allowTrials
                  ? "Proposals and reviewed local trials enabled"
                  : "Proposals only"}
              </strong>
              . Approval, secrets, SSO sessions, shell commands and application
              source writes are not exposed by these tools.
            </p>
            <label>
              Private connection file
              <input readOnly value={agent.file ?? ""} />
            </label>
            <p className="automate-note">
              Set SUPERQ_AGENT_CONNECTION to this path and launch npm run mcp
              --silent from this repository in your host configuration. Treat
              the file as a credential. Revoking access or closing Studio
              invalidates it.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
function RecipeSummary({ recipe }: { recipe: Recipe }) {
  return recipe.kind === "api" ? (
    <ol>
      {recipe.requests.map((r, i) => (
        <li key={i}>
          <strong>
            {r.method} {r.path}
          </strong>
          {r.body !== undefined && <pre>{JSON.stringify(r.body, null, 2)}</pre>}
          <ul>
            {r.assertions.map((a, j) => (
              <li key={j}>
                {a.path} {a.operator} {JSON.stringify(a.expected)}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  ) : (
    <ol>
      {recipe.commands.map((c, i) => (
        <li key={i}>
          {"path" in c
            ? `Navigate to ${c.path}`
            : `${c.type} · ${c.locator.strategy}: ${c.locator.name ?? c.locator.value}${"value" in c ? ` → ${c.value}` : ""}`}
        </li>
      ))}
    </ol>
  );
}
function Mapping({
  candidate: c,
  kind,
  roles,
  accounts,
  save,
}: {
  candidate: Candidate;
  kind: "api" | "web";
  roles: string[];
  accounts: Record<string, { role: string }>;
  save: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [recipe, setRecipe] = useState<Recipe>(
    c.recipe ??
      (kind === "api"
        ? {
            kind: "api",
            requests: [
              {
                path: "",
                method: "GET",
                assertions: [
                  { path: "status", operator: "equals", expected: 200 },
                  { path: "body.status", operator: "equals", expected: "" },
                ],
              },
            ],
          }
        : {
            kind: "web",
            commands: [
              { type: "goto", path: "" },
              {
                type: "expectText",
                locator: { strategy: "text", value: "" },
                value: "",
              },
            ],
          }),
  );
  const [role, setRole] = useState(c.role ?? "");
  const [user, setUser] = useState(c.user ?? "");
  const [anonymous, setAnonymous] = useState(c.anonymous ?? false);
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState("");
  const [bodies, setBodies] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const update = () => setRecipe(structuredClone(recipe));
  return (
    <form
      className="intake-mapping"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const mapped = structuredClone(recipe);
          if (mapped.kind === "api")
            for (const [index, body] of Object.entries(bodies)) {
              const request = mapped.requests[Number(index)];
              if (request) {
                if (body.trim()) request.body = JSON.parse(body);
                else delete request.body;
              }
            }
          await save({
            recipe: advanced ? JSON.parse(advanced) : mapped,
            role: anonymous ? "" : role,
            user: anonymous ? "" : user,
            anonymous,
          });
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Map the documented steps</h3>
      <p className="automate-note">
        Use exact screen labels and independently confirmed results. Use $
        {"{variable}"} for environment or test data. Do not put credentials in
        this mapping.
      </p>
      {recipe.kind === "api"
        ? recipe.requests.map((r, n) => (
            <fieldset key={n}>
              <legend>Request {n + 1}</legend>
              <div className="automate-field-row">
                <label>
                  Method
                  <select
                    value={r.method}
                    onChange={(e) => {
                      r.method = e.target.value as typeof r.method;
                      update();
                    }}
                  >
                    {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map(
                      (m) => (
                        <option key={m}>{m}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Application path
                  <input
                    required
                    value={r.path}
                    placeholder="/api/health"
                    onChange={(e) => {
                      r.path = e.target.value;
                      update();
                    }}
                  />
                </label>
              </div>
              {r.assertions.map((a, j) => (
                <div className="automate-field-row" key={j}>
                  <label>
                    Response field
                    <input
                      value={a.path}
                      onChange={(e) => {
                        a.path = e.target.value;
                        update();
                      }}
                      required
                    />
                  </label>
                  <label>
                    Expected value
                    <input
                      value={
                        typeof a.expected === "string"
                          ? a.expected
                          : JSON.stringify(a.expected)
                      }
                      onChange={(e) => {
                        let expected: unknown = e.target.value;
                        try {
                          expected = JSON.parse(e.target.value);
                        } catch {}
                        a.expected = expected;
                        update();
                      }}
                      required
                    />
                    <small>
                      JSON for typed numbers, booleans and objects; other text
                      is a string.
                    </small>
                  </label>
                </div>
              ))}
            </fieldset>
          ))
        : recipe.commands.map((c, n) => (
            <fieldset key={n}>
              <legend>
                Step {n + 1} · {c.type}
              </legend>
              {"path" in c ? (
                <label>
                  Application path
                  <input
                    required
                    value={c.path}
                    placeholder="/checkout"
                    onChange={(e) => {
                      c.path = e.target.value;
                      update();
                    }}
                  />
                </label>
              ) : (
                <>
                  <div className="automate-field-row">
                    <label>
                      Find control by
                      <select
                        value={c.locator.strategy}
                        onChange={(e) => {
                          c.locator.strategy = e.target
                            .value as typeof c.locator.strategy;
                          update();
                        }}
                      >
                        <option value="label">Field label</option>
                        <option value="role">Role</option>
                        <option value="testId">Test ID</option>
                        <option value="text">Exact text</option>
                      </select>
                    </label>
                    <label>
                      {c.locator.strategy === "role"
                        ? "Role (button, heading, status…)"
                        : "Exact label / ID / text"}
                      <input
                        required
                        value={c.locator.value}
                        onChange={(e) => {
                          c.locator.value = e.target.value;
                          update();
                        }}
                      />
                    </label>
                    {c.locator.strategy === "role" && (
                      <label>
                        Accessible name
                        <input
                          value={c.locator.name ?? ""}
                          onChange={(e) => {
                            c.locator.name = e.target.value;
                            update();
                          }}
                        />
                      </label>
                    )}
                  </div>
                  {c.type === "expectCount" && (
                    <label>
                      Expected element count
                      <input
                        type="number"
                        min={0}
                        required
                        value={c.count}
                        onChange={(e) => {
                          c.count = Number(e.target.value);
                          update();
                        }}
                      />
                    </label>
                  )}
                  {"value" in c && (
                    <label>
                      {c.type === "fill"
                        ? "Input value or data variable"
                        : "Expected visible text"}
                      <input
                        required
                        value={c.value}
                        onChange={(e) => {
                          c.value = e.target.value;
                          update();
                        }}
                      />
                    </label>
                  )}
                </>
              )}
              <div className="automate-actions">
                <button
                  type="button"
                  className="button"
                  disabled={n === 0}
                  aria-label={`Move step ${n + 1} up`}
                  onClick={() => {
                    if (recipe.kind === "web" && n > 0) {
                      const previous = recipe.commands[n - 1]!;
                      recipe.commands[n - 1] = c;
                      recipe.commands[n] = previous;
                      update();
                    }
                  }}
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={
                    recipe.kind !== "web" || n === recipe.commands.length - 1
                  }
                  aria-label={`Move step ${n + 1} down`}
                  onClick={() => {
                    if (
                      recipe.kind === "web" &&
                      n < recipe.commands.length - 1
                    ) {
                      const next = recipe.commands[n + 1]!;
                      recipe.commands[n + 1] = c;
                      recipe.commands[n] = next;
                      update();
                    }
                  }}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    if (recipe.kind === "web") recipe.commands.splice(n, 1);
                    update();
                  }}
                >
                  Remove step
                </button>
              </div>
            </fieldset>
          ))}
      {recipe.kind === "web" && (
        <div className="automate-actions">
          {(["goto", "fill", "click", "expectText"] as const).map((type) => (
            <button
              className="button"
              type="button"
              key={type}
              onClick={() => {
                const command: Extract<
                  Recipe,
                  { kind: "web" }
                >["commands"][number] =
                  type === "goto"
                    ? { type, path: "" }
                    : type === "click"
                      ? {
                          type,
                          locator: {
                            strategy: "role",
                            value: "button",
                            name: "",
                          },
                        }
                      : {
                          type,
                          locator: {
                            strategy: type === "fill" ? "label" : "text",
                            value: "",
                          },
                          value: "",
                        };
                const last = recipe.commands.at(-1);
                recipe.commands.splice(
                  last?.type === "expectText" && type !== "expectText"
                    ? recipe.commands.length - 1
                    : recipe.commands.length,
                  0,
                  command,
                );
                update();
              }}
            >
              Add {type}
            </button>
          ))}
        </div>
      )}
      {recipe.kind === "api" && (
        <button
          type="button"
          className="button"
          onClick={() => {
            recipe.requests.push({
              path: "",
              method: "GET",
              assertions: [
                { path: "status", operator: "equals", expected: 200 },
                { path: "body.status", operator: "equals", expected: "" },
              ],
            });
            update();
          }}
        >
          Add API request
        </button>
      )}
      {recipe.kind === "web" && (
        <label>
          More Playwright actions
          <select
            value=""
            onChange={(e) => {
              const type = e.target.value;
              let command: Extract<Recipe, { kind: "web" }>["commands"][number];
              if (type === "expectURL") command = { type, path: "" };
              else if (type === "expectCount")
                command = {
                  type,
                  locator: { strategy: "role", value: "listitem" },
                  count: 1,
                };
              else if (type === "selectOption" || type === "expectValue")
                command = {
                  type,
                  locator: { strategy: "label", value: "" },
                  value: "",
                };
              else if (
                type === "check" ||
                type === "uncheck" ||
                type === "expectVisible"
              )
                command = { type, locator: { strategy: "label", value: "" } };
              else return;
              const last = recipe.commands.at(-1);
              recipe.commands.splice(
                !type.startsWith("expect") && last?.type.startsWith("expect")
                  ? recipe.commands.length - 1
                  : recipe.commands.length,
                0,
                command,
              );
              update();
            }}
          >
            <option value="">Add an interaction or assertion…</option>
            <option value="selectOption">Select dropdown option</option>
            <option value="check">Check checkbox</option>
            <option value="uncheck">Uncheck checkbox</option>
            <option value="expectValue">Assert field value</option>
            <option value="expectVisible">Assert visible element</option>
            <option value="expectCount">Assert element count</option>
            <option value="expectURL">Assert application URL</option>
          </select>
        </label>
      )}
      <label>
        Required business role
        <select
          value={role}
          disabled={anonymous}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="">Environment default / no required role</option>
          {roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label>
        Environment account
        <select
          disabled={anonymous}
          value={user}
          onChange={(e) => setUser(e.target.value)}
        >
          <option value="">Resolve from role / environment default</option>
          {Object.entries(accounts).map(([alias, account]) => (
            <option key={alias} value={alias}>
              {alias} · {account.role}
            </option>
          ))}
        </select>
      </label>
      <label className="intake-check">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
        />
        Explicitly anonymous test
      </label>
      <details>
        <summary>
          Advanced recipe JSON (multiple requests, request bodies, assertion
          operators)
        </summary>
        <textarea
          rows={10}
          value={advanced || JSON.stringify(recipe, null, 2)}
          onChange={(e) => setAdvanced(e.target.value)}
        />
      </details>
      {error && (
        <p role="alert" className="automate-error">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        Save mapping for review
      </button>
    </form>
  );
}
