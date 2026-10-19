import { useState } from "react";
import { designPairwise, type TestDesign } from "../src/test-design";
import "./coverage-lab.css";
const initial: TestDesign = {
  title: "Checkout compatibility",
  evidence: { source: "", revision: "", excerpt: "" },
  factors: [
    { name: "browser", values: ["Chromium", "Firefox", "WebKit"] },
    { name: "customer", values: ["Guest", "Registered"] },
    { name: "payment", values: ["Card", "Wallet"] },
  ],
  forbidden: [],
};
type Result = ReturnType<typeof designPairwise>;
export default function CoverageLab({
  value,
  save,
}: {
  value?: TestDesign;
  save: (design: TestDesign, baseDesign: TestDesign | null) => Promise<boolean>;
}) {
  const [baseDesign, setBaseDesign] = useState<TestDesign | null>(
    value ?? null,
  );
  const [draft, setDraft] = useState(value ?? initial),
    [rules, setRules] = useState(
      JSON.stringify(value?.forbidden ?? [], null, 2),
    ),
    [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState("");
  const edit = (next: TestDesign) => {
    setDraft(next);
    setResult(null);
    setError("");
  };
  function generate() {
    try {
      const r = designPairwise({ ...draft, forbidden: JSON.parse(rules) });
      setResult(r);
      setError("");
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "superq-pairwise-design.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="coverage-lab">
      <div className="lab-heading">
        <span className="badge">No model tokens required</span>
        <h1>Coverage Lab</h1>
        <p>
          Cover interacting input choices with fewer datasets. Start with your
          business factors, exclude impossible combinations, then inspect the
          generated rows.
        </p>
      </div>
      <div className="lab-layout">
        <div>
          <div className="panel lab-card">
            <h2>1. Define the context</h2>
            <label>
              Design name
              <input
                value={draft.title}
                onChange={(e) => edit({ ...draft, title: e.target.value })}
              />
            </label>
            <div className="lab-two">
              <label>
                Source document or story
                <input
                  value={draft.evidence.source}
                  placeholder="ADO/US-123 or docs/checkout.md"
                  onChange={(e) =>
                    edit({
                      ...draft,
                      evidence: { ...draft.evidence, source: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Source revision
                <input
                  value={draft.evidence.revision}
                  onChange={(e) =>
                    edit({
                      ...draft,
                      evidence: { ...draft.evidence, revision: e.target.value },
                    })
                  }
                />
              </label>
            </div>
            <label>
              Relevant rule or excerpt
              <textarea
                rows={3}
                value={draft.evidence.excerpt}
                onChange={(e) =>
                  edit({
                    ...draft,
                    evidence: { ...draft.evidence, excerpt: e.target.value },
                  })
                }
              />
            </label>
          </div>
          <div className="panel lab-card">
            <h2>2. Choose factors and values</h2>
            <p>
              One value per line. Examples: browser, customer role, currency,
              payment method. These are data choices, not browser session
              settings.
            </p>
            {draft.factors.map((f, i) => (
              <div className="lab-factor" key={i}>
                <label>
                  Factor {i + 1}
                  <input
                    value={f.name}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        factors: draft.factors.map((v, j) =>
                          i === j ? { ...v, name: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Values for factor {i + 1}
                  <textarea
                    rows={3}
                    value={f.values.join("\n")}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        factors: draft.factors.map((v, j) =>
                          i === j
                            ? { ...v, values: e.target.value.split("\n") }
                            : v,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="button"
                  disabled={draft.factors.length <= 2}
                  aria-label={`Remove factor ${i + 1}`}
                  onClick={() =>
                    edit({
                      ...draft,
                      factors: draft.factors.filter((_, j) => i !== j),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="button"
              disabled={draft.factors.length >= 8}
              onClick={() =>
                edit({
                  ...draft,
                  factors: [
                    ...draft.factors,
                    {
                      name: `factor${draft.factors.length + 1}`,
                      values: ["First", "Second"],
                    },
                  ],
                })
              }
            >
              Add factor
            </button>
          </div>
          <div className="panel lab-card">
            <h2>3. Exclude impossible combinations</h2>
            <p>
              Optional JSON: each object forbids rows matching all of its
              values. Example:{" "}
              <code>{'[{"customer":"Guest","payment":"Wallet"}]'}</code>.
              Constraints change the denominator; review them carefully.
            </p>
            <label>
              Forbidden combinations
              <textarea
                rows={4}
                value={rules}
                onChange={(e) => {
                  setRules(e.target.value);
                  setResult(null);
                }}
              />
            </label>
            <p>
              Up to 8 factors, 10 values each and 4,096 total candidate rows.
              Larger models should be split into business contexts.
            </p>
            {error && (
              <p role="alert" className="lab-error">
                {error}
              </p>
            )}
            <div className="lab-actions">
              <button className="button primary" onClick={() => generate()}>
                Generate pairwise data
              </button>
              <button
                className="button"
                onClick={async () => {
                  const r = generate();
                  if (r && (await save(r.model, baseDesign)))
                    setBaseDesign(r.model);
                }}
              >
                Save design
              </button>
            </div>
          </div>
        </div>
        <aside className="panel lab-card lab-explanation">
          <h2>What this covers</h2>
          <p>
            Every feasible value and every feasible pair across different
            factors appears in at least one selected row.
          </p>
          <h3>What needs separate tests</h3>
          <p>
            Business outcomes, negative inputs, boundaries, security, timing and
            interactions involving three or more factors.
          </p>
          <h3>Keep the evidence visible</h3>
          <p>
            Exports retain the model, constraints, source revision and
            generation algorithm. Saving a design does not approve tests or
            increase proven coverage.
          </p>
        </aside>
      </div>
      {result && (
        <div className="panel lab-card" aria-live="polite">
          <h2>Review your dataset</h2>
          <div className="lab-metrics">
            <div>
              <strong>{result.summary.selectedRows}</strong>
              <span>selected datasets</span>
            </div>
            <div>
              <strong>{result.summary.validCombinations}</strong>
              <span>valid full combinations</span>
            </div>
            <div>
              <strong>
                {result.summary.coveredObligations}/
                {result.summary.requiredObligations}
              </strong>
              <span>feasible value & pair obligations</span>
            </div>
          </div>
          <p>
            {result.summary.theoreticalCombinations -
              result.summary.validCombinations}{" "}
            full combinations excluded by your constraints. Pairwise design is
            not exhaustive testing or proof of application quality.
          </p>
          {result.infeasibleValues.map((v, i) => (
            <p className="lab-error" key={i}>
              Unreachable value: {v.factor} = {v.value}. Review constraints.
            </p>
          ))}
          <div className="lab-table">
            <table>
              <thead>
                <tr>
                  <th>Dataset</th>
                  {result.model.factors.map((f) => (
                    <th key={f.name}>{f.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    {result.model.factors.map((f) => (
                      <td key={f.name}>{r[f.name]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="button primary" onClick={download}>
            Export model & data
          </button>
          <p>
            Export remains review-required. Supply expected outcomes before
            using these rows in executable tests.
          </p>
        </div>
      )}
    </section>
  );
}
