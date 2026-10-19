import { useState } from "react";
import type { Project } from "../src/model";
import type { WorkspaceState } from "../src/workspace-server";
import "./automate.css";
type Props = {
  project: Project;
  runs: WorkspaceState["runs"];
  sample: boolean;
  save: (test: Record<string, unknown>) => Promise<boolean>;
  run: (input: Record<string, unknown>) => Promise<boolean>;
  openTest: (id: string) => void;
  setup: () => void;
  addExpectation: () => void;
};
export default function Automate({
  project: p,
  runs,
  sample,
  save,
  run,
  openTest,
  setup,
  addExpectation,
}: Props) {
  const [choice, setChoice] = useState(""),
    [role, setRole] = useState(""),
    [account, setAccount] = useState(""),
    [kind, setKind] = useState<"web" | "api">("web"),
    [path, setPath] = useState(""),
    [button, setButton] = useState(""),
    [fields, setFields] = useState<{ label: string; value: string }[]>([]),
    [text, setText] = useState(""),
    [target, setTarget] = useState(""),
    [where, setWhere] = useState<"text" | "heading" | "status" | "testId">(
      "text",
    ),
    [responseField, setResponseField] = useState(""),
    [expected, setExpected] = useState(""),
    [method, setMethod] = useState("GET"),
    [body, setBody] = useState(""),
    [code, setCode] = useState(200),
    [created, setCreated] = useState(""),
    [lastRunAt, setLastRunAt] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [environment, setEnvironment] = useState(
      Object.keys(p.environments)[0] ?? "",
    );
  const options = p.requirements.flatMap((r) =>
    r.criteria.map((c) => ({
      value: JSON.stringify([r.id, c.id]),
      title: c.title,
      requirement: r.title,
    })),
  );
  const selected = options.find((o) => o.value === choice);
  const local = Object.entries(p.browsers).find(
    ([, b]) => b.provider === "local",
  );
  const job = created
    ? runs.find((r) =>
        lastRunAt
          ? r.at >= lastRunAt
          : r.report?.results.some((t) => t.id === created),
      )
    : undefined;
  const result =
    job?.state === "completed"
      ? job.report?.results.find((t) => t.id === created)
      : undefined;
  async function create() {
    setError("");
    if (!selected) {
      setError("Choose what you want to verify.");
      return;
    }
    try {
      if (!path.trim()) throw new Error("Enter the page or API path.");
      if (kind === "web" && !text.trim())
        throw new Error("Enter the text you expect to see.");
      if (kind === "api" && !responseField.trim())
        throw new Error("Enter the response field to check.");
      if (kind === "web" && fields.some((f) => !f.label.trim()))
        throw new Error("Enter the label of each field to fill.");
      const [requirementId, criterionId] = JSON.parse(choice);
      const id = `SQ-${crypto.randomUUID()}`;
      const parse = (value: string) => {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      };
      const test = {
        id,
        title: selected.title,
        requirementId,
        criterionId,
        path,
        kind,
        ...(role === "__anonymous__"
          ? { anonymous: true }
          : role
            ? { role }
            : {}),
        ...(kind === "web"
          ? { button, fields, expectation: { kind: where, text, target } }
          : {
              method,
              status: code,
              responseField,
              expected: parse(expected),
              ...(body.trim() ? { body: JSON.parse(body) } : {}),
            }),
      };
      if (kind === "api" && !expected.trim())
        throw new Error(
          "Enter the expected field value. Use JSON quotes for an empty string.",
        );
      setBusy(true);
      if (await save(test)) setCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="automate-home">
      <div className="automate-intro">
        <span className="badge">Functional testing, simplified</span>
        <h1>What would you like to test?</h1>
        <p>Choose an expectation. Add the interaction. Try your test.</p>
        {sample && (
          <p className="automate-sample">
            You’re in a sample application.{" "}
            <button onClick={setup}>Connect your application</button> when
            you’re ready.
          </p>
        )}
        <p className="automate-note">
          Have a repository or manual suite?{" "}
          <a href="#intake">
            Start from sources and review a guided automation plan →
          </a>
        </p>
      </div>
      {!created ? (
        <div className="automate-card">
          <h2>
            <span>1</span> What should happen?
          </h2>
          {options.length ? (
            <label>
              Functional expectation
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
              >
                <option value="">Choose an existing expectation…</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.title} — {o.requirement}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>
              Add an expectation for the feature you want to test first.{" "}
              <button className="button" onClick={addExpectation}>
                Add an expectation
              </button>
            </p>
          )}
          {Object.keys(p.roles ?? {}).length > 0 && (
            <label>
              Application role
              <select
                aria-label="Application role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="">Use environment default</option>
                <option value="__anonymous__">Anonymous (no login)</option>
                {Object.keys(p.roles ?? {}).map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          )}
          <h2>
            <span>2</span> How do you want to check it?
          </h2>
          <div className="automate-choice" role="group" aria-label="Test type">
            <button
              aria-pressed={kind === "web"}
              onClick={() => setKind("web")}
            >
              On a screen
            </button>
            <button
              aria-pressed={kind === "api"}
              onClick={() => setKind("api")}
            >
              Through an API
            </button>
          </div>
          <label>
            {kind === "web" ? "Page path" : "API path"}
            <input
              aria-label={kind === "web" ? "Page path" : "API path"}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={kind === "web" ? "checkout" : "api/inventory"}
            />
            <small>Relative to your application’s configured address.</small>
          </label>
          {kind === "web" ? (
            <>
              <div className="automate-fields">
                {fields.map((f, i) => (
                  <div key={i} className="automate-field-row">
                    <label>
                      Field label
                      <input
                        value={f.label}
                        onChange={(e) =>
                          setFields(
                            fields.map((v, j) =>
                              j === i ? { ...v, label: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Enter this value
                      <input
                        value={f.value}
                        onChange={(e) =>
                          setFields(
                            fields.map((v, j) =>
                              j === i ? { ...v, value: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      aria-label={`Remove field ${i + 1}`}
                      className="button"
                      onClick={() =>
                        setFields(fields.filter((_, j) => j !== i))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="button"
                onClick={() => setFields([...fields, { label: "", value: "" }])}
              >
                Add a field to fill
              </button>
              <label>
                Button to click (optional)
                <input
                  value={button}
                  onChange={(e) => setButton(e.target.value)}
                  placeholder="Place order"
                />
              </label>
              <label>
                Expected text
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Order confirmed"
                />
              </label>
              <details>
                <summary>Where should this text appear?</summary>
                <label>
                  Result location
                  <select
                    value={where}
                    onChange={(e) => setWhere(e.target.value as typeof where)}
                  >
                    <option value="text">Anywhere on screen</option>
                    <option value="heading">Page heading</option>
                    <option value="status">Status message</option>
                    <option value="testId">Element with a test ID</option>
                  </select>
                </label>
                {where === "testId" && (
                  <label>
                    Result element test ID
                    <input
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    />
                  </label>
                )}
              </details>
            </>
          ) : (
            <>
              <div className="automate-field-row">
                <label>
                  Response field
                  <input
                    value={responseField}
                    onChange={(e) => setResponseField(e.target.value)}
                    placeholder="available"
                  />
                </label>
                <label>
                  Expected value
                  <input
                    aria-label="Expected value"
                    value={expected}
                    onChange={(e) => setExpected(e.target.value)}
                    placeholder="true"
                  />
                  <small>
                    Numbers, true/false and JSON stay typed; other text is a
                    string.
                  </small>
                </label>
              </div>
              <details>
                <summary>Request options</summary>
                <label>
                  Method
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Expected HTTP status
                  <input
                    type="number"
                    value={code}
                    onChange={(e) => setCode(Number(e.target.value))}
                  />
                </label>
                <label>
                  Request body (JSON, optional)
                  <textarea
                    rows={4}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </label>
              </details>
            </>
          )}
          {error && (
            <p role="alert" className="automate-error">
              {error}
            </p>
          )}
          <button
            className="button primary"
            disabled={busy || !selected}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create functional test"}
          </button>
          <p className="automate-note">
            Your test is saved as a draft. Try it, then review the result.
          </p>
        </div>
      ) : (
        <div className="automate-card" aria-live="polite">
          <h2>Your test is ready to try.</h2>
          <p>{selected?.title}</p>
          <label>
            Application environment
            <select
              value={environment}
              onChange={(e) => {
                setEnvironment(e.target.value);
                setAccount("");
              }}
            >
              {Object.keys(p.environments).map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          {!p.tests.find((t) => t.id === created)?.anonymous &&
            Object.keys(p.environments[environment]?.users ?? {}).length >
              0 && (
              <label>
                Test account
                <select
                  aria-label="Test account"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">
                    Choose automatically from role/default
                  </option>
                  {Object.entries(p.environments[environment]?.users ?? {})
                    .filter(([, u]) => !role || u.role === role)
                    .map(([id, u]) => (
                      <option key={id} value={id}>
                        {id} ({u.role})
                      </option>
                    ))}
                </select>
              </label>
            )}
          <p>
            Runs with{" "}
            {local
              ? `${local[1].browser} on this machine`
              : "no local browser configured"}
            . This may interact with application data.
          </p>
          <div className="automate-actions">
            <button
              className="button primary"
              disabled={
                busy || !local || runs.some((r) => r.state === "running")
              }
              onClick={async () => {
                setLastRunAt(new Date().toISOString());
                setBusy(true);
                try {
                  await run({
                    environment,
                    ...(account ? { user: account } : {}),
                    suite: p.tests.find((t) => t.id === created)?.suites[0],
                    profile: local?.[0],
                    workers: 1,
                    testIds: [created],
                    validateDrafts: true,
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Try this test
            </button>
            <button className="button" onClick={() => openTest(created)}>
              Review or extend test
            </button>
          </div>
          {job?.state === "running" && <p>Checking your application…</p>}
          {job?.state === "failed" && (
            <p role="alert">
              {job.error || "The run could not finish. Check Runs & reports."}
            </p>
          )}
          {job?.state === "completed" && !result && (
            <p role="alert">
              No result was produced for this test. Open Runs & reports to check
              run filters or setup.
            </p>
          )}
          {result && (
            <div className={`automate-result ${result.status}`}>
              <strong>
                {result.status === "passed"
                  ? "The check passed"
                  : `The check ${result.status}`}
              </strong>
              <p>
                {result.reason ||
                  "The interaction and expected result were checked."}
              </p>
              <p>
                This draft run is exploratory. Review the test before counting
                it as release evidence.
              </p>
            </div>
          )}
          <button
            className="button"
            disabled={runs.some((r) => r.state === "running")}
            onClick={() => {
              setCreated("");
              setLastRunAt(null);
              setError("");
            }}
          >
            Add another test
          </button>
        </div>
      )}
      <p className="automate-footer">
        Need longer journeys, shared test data, database checks or custom code?
        Open the full test editor. Suite, browser and pipeline settings remain
        available in More tools.
      </p>
    </section>
  );
}
