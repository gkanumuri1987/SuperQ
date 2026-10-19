import SetupMaintenance from "./SetupMaintenance";
import { useState } from "react";
import type { WorkspaceState } from "../src/workspace-server";
import type { catalogHealth } from "../src/catalog";
import "./quality.css";
export type Care = {
  frameworkCurrent: boolean;
  catalog: ReturnType<typeof catalogHealth>;
  repairs: {
    runId: string;
    testId: string;
    title: string;
    observationIndex: number;
    original?: string;
    replacement?: string;
    step: number;
    command?: number;
    current: boolean;
  }[];
};
export function Capabilities({
  go,
  tests,
  openQuality,
}: {
  go: (page: string) => void;
  tests: number;
  openQuality: (view: string) => void;
}) {
  return (
    <nav className="capability-strip" aria-label="Automation capabilities">
      {[
        ["Connect & generate", "Repo, manual suite or criteria", "intake"],
        ["Auto healing", "Review catalog-based repairs", "quality"],
        ["Framework maintenance", "Check versions & browsers", "quality"],
        ["Shared catalog", "Reuse actions & locators", "catalog"],
        ["Reports", "Results, blockers & evidence", "runs"],
        [
          "Feature coverage",
          tests
            ? `${tests} test${tests === 1 ? "" : "s"} · find remaining gaps`
            : "No tests yet · generate a plan",
          tests ? "coverage" : "intake",
        ],
      ].map(([title, description, page]) => (
        <button
          key={title}
          onClick={() =>
            page === "quality"
              ? openQuality(
                  title === "Framework maintenance" ? "framework" : "healing",
                )
              : go(page!)
          }
        >
          <strong>{title}</strong>
          <small>{description}</small>
        </button>
      ))}
    </nav>
  );
}
export default function Quality({
  state,
  care,
  action,
  go,
  view,
  onViewChange,
}: {
  view: string;
  onViewChange: (view: string) => void;
  state: WorkspaceState;
  care: Care;
  action: (path: string, body: Record<string, unknown>) => Promise<boolean>;
  go: (page: string) => void;
}) {
  const p = state.project;
  const tab = view,
    setTab = onViewChange;
  const [enabled, setEnabled] = useState(p.healing?.enabled ?? false),
    [original, setOriginal] = useState(""),
    [alternative, setAlternative] = useState(""),
    [strategy, setStrategy] = useState<"testId" | "label" | "text" | "role">(
      "testId",
    ),
    [value, setValue] = useState(""),
    [name, setName] = useState(""),
    [pending, setPending] = useState(false);
  const [base] = useState(p.healing);
  const act = async (path: string, body: Record<string, unknown>) => {
    setPending(true);
    try {
      return await action(path, body);
    } finally {
      setPending(false);
    }
  };
  const check = state.frameworkCheck;
  return (
    <div className="quality-home automate-home">
      <div className="automate-intro">
        <span className="eyebrow">AUTOMATION CARE</span>
        <h1>Keep automation healthy.</h1>
        <p>
          Reuse the catalog, diagnose failures and maintain the framework with
          clear review checkpoints.
        </p>
      </div>
      <div className="automate-choice" aria-label="Maintenance view">
        {["healing", "framework", "catalog"].map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === "healing"
              ? "Auto healing"
              : t === "framework"
                ? "Framework health"
                : "Catalog reuse"}
          </button>
        ))}
      </div>
      {tab === "healing" && (
        <section className="automate-card">
          <h2>Catalog-based auto healing</h2>
          <p>
            When a control is missing, an enabled local run can try one
            configured catalog alternative. The original must remain absent and
            exactly one alternative must be uniquely visible. Expectations stay
            unchanged; mismatches and ambiguous controls are not healed.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await act("healing/configure", {
                base,
                settings: {
                  enabled,
                  ...(original
                    ? {
                        original,
                        ...(alternative
                          ? { alternative }
                          : {
                              definition: {
                                strategy,
                                value,
                                ...(strategy === "role" ? { name } : {}),
                              },
                            }),
                      }
                    : {}),
                },
              });
            }}
          >
            <label className="quality-check">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enable bounded speculative healing for local runs
            </label>
            <label>
              Original catalog locator
              <select
                aria-label="Original catalog locator"
                value={original}
                onChange={(e) => setOriginal(e.target.value)}
              >
                <option value="">Save policy only</option>
                {Object.entries(p.locators).map(([id, l]) => (
                  <option key={id} value={id}>
                    {id} · {l.name ?? l.value}
                  </option>
                ))}
              </select>
            </label>
            {original && (
              <>
                <label>
                  Catalog alternative
                  <select
                    aria-label="Catalog alternative"
                    value={alternative}
                    onChange={(e) => setAlternative(e.target.value)}
                  >
                    <option value="">
                      Add or reuse an exact locator definition
                    </option>
                    {Object.entries(p.locators)
                      .filter(([id]) => id !== original)
                      .map(([id, l]) => (
                        <option key={id} value={id}>
                          {id} · {l.name ?? l.value}
                        </option>
                      ))}
                  </select>
                </label>
                {!alternative && (
                  <>
                    <div className="automate-field-row">
                      <label>
                        Locator strategy
                        <select
                          aria-label="Locator strategy"
                          value={strategy}
                          onChange={(e) =>
                            setStrategy(e.target.value as typeof strategy)
                          }
                        >
                          {["testId", "label", "role", "text"].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Exact value
                        <input
                          required
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                        />
                      </label>
                    </div>
                    {strategy === "role" && (
                      <label>
                        Accessible name
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </label>
                    )}
                  </>
                )}
              </>
            )}
            <button className="button primary" disabled={pending}>
              Save healing policy
            </button>
          </form>
          {Object.entries(p.healing?.locators ?? {}).map(([from, to]) => (
            <div className="quality-rule" key={from}>
              <span>
                {from} → {to.join(", ")}
              </span>
              <button
                className="button"
                disabled={pending}
                onClick={() =>
                  void act("healing/configure", {
                    base,
                    settings: {
                      enabled: p.healing!.enabled,
                      removeOriginal: from,
                    },
                  })
                }
              >
                Remove mapping
              </button>
            </div>
          ))}
          <p className="automate-note">
            Disabled by default. At most one repair attempt per test. No AI
            call, expectation weakening or hidden retry. A healed run is
            explicitly flagged and cannot supply clean release proof.
          </p>
          <h2>Repairs from passing speculative trials</h2>
          {!care.repairs.length && (
            <p>
              No passing healing trial yet. Configure an alternative and run the
              affected case from the test library or Runs & reports.
            </p>
          )}
          {care.repairs.map((r) => (
            <article
              className="quality-repair"
              key={`${r.runId}-${r.testId}-${r.observationIndex}`}
            >
              <strong>{r.title}</strong>
              <p>
                Step {r.step}, command {r.command}: {r.original} →{" "}
                {r.replacement}
              </p>
              <button
                className="button"
                disabled={
                  pending ||
                  state.runs.some((r) => r.state === "running") ||
                  !r.current
                }
                onClick={() =>
                  void act("healing/stage", {
                    runId: r.runId,
                    testId: r.testId,
                    observationIndex: r.observationIndex,
                  })
                }
              >
                Apply repair as draft
              </button>
              <small>
                {r.current
                  ? "Review the saved draft in the test library, then run normally to establish clean evidence."
                  : "Project changed after this trial. Rerun before staging."}
              </small>
            </article>
          ))}
          <div className="automate-actions">
            <button className="button" onClick={() => go("tests")}>
              Review saved tests
            </button>
            <button className="button" onClick={() => go("runs")}>
              Run & inspect reports
            </button>
          </div>
        </section>
      )}
      {tab === "framework" && (
        <section className="automate-card">
          <h2>Framework maintenance</h2>
          <p>
            Check the installed runtime, pinned package versions, browser
            binaries, credentials by name and unsupported Studio actions before
            planning upgrades.
          </p>
          <button
            className="button primary"
            disabled={pending}
            onClick={() => void act("framework-check", {})}
          >
            Run local framework checks
          </button>
          {check && (
            <>
              <p>
                {!care.frameworkCurrent &&
                  "Project changed since these checks; rerun them. "}
                Checked {new Date(check.at).toLocaleString()} · Node{" "}
                {check.report.node} ·{" "}
                {check.report.nodeSupported
                  ? "meets the configured runtime minimum"
                  : "runtime upgrade required"}
              </p>
              <div className="quality-table">
                <table>
                  <thead>
                    <tr>
                      <th>Package</th>
                      <th>Installed</th>
                      <th>Locked</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.report.packages.map((item) => (
                      <tr key={item.name}>
                        <td>{item.name}</td>
                        <td>{item.installed ?? "Unknown"}</td>
                        <td>{item.locked ?? "Unknown"}</td>
                        <td>{item.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {check.report.browsers.map((b) => (
                <p key={b.name}>
                  <strong>
                    {b.name} · {b.browser}
                  </strong>
                  : {b.status}
                  {b.missingCredentialNames.length
                    ? ` · Missing secret references: ${b.missingCredentialNames.join(", ")}`
                    : ""}
                </p>
              ))}
              {!!check.report.unsupportedStudioActions.length && (
                <p className="automate-error">
                  Custom/unsupported Studio actions:{" "}
                  {check.report.unsupportedStudioActions.join(", ")}. Supply an
                  owned programmatic registry.
                </p>
              )}
              <h3>Upgrade review checklist</h3>
              <ol>
                {check.report.checks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
              <p className="automate-note">{check.report.notice}</p>
            </>
          )}
        </section>
      )}
      {tab === "catalog" && (
        <section className="automate-card">
          <h2>Reuse before generating</h2>
          <p>
            {care.catalog.actions.length} shared actions ·{" "}
            {care.catalog.locators.length} shared locators ·{" "}
            {care.catalog.duplicateCandidates.length} duplicate-flow candidates
          </p>
          {care.catalog.actions.map((a) => (
            <div className="quality-rule" key={a.id}>
              <strong>{a.id}</strong>
              <span>
                {a.kind}:{a.operation} · {a.testIds.length} tests
              </span>
            </div>
          ))}
          <SetupMaintenance project={p} action={action} />
          <h3>Duplicate candidates</h3>
          {care.catalog.duplicateCandidates.length ? (
            care.catalog.duplicateCandidates.map((ids) => (
              <p key={ids.join()}>{ids.join(" · ")}</p>
            ))
          ) : (
            <p>No exact duplicate flows found.</p>
          )}
          <p>
            Unreferenced actions:{" "}
            {care.catalog.unusedActions.join(", ") || "None"}
          </p>
          <p>
            Unreferenced locators:{" "}
            {care.catalog.unusedLocators.join(", ") || "None"}
          </p>
          <p className="automate-note">{care.catalog.notice}</p>
          <div className="automate-actions">
            <button className="button" onClick={() => go("catalog")}>
              Open shared catalog
            </button>
            <button className="button primary" onClick={() => go("intake")}>
              Generate or enhance feature tests
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
