import { useState } from "react";
import { Planning as Schema, assessPlanning } from "../src/planning";
import type { Planning } from "../src/planning";
const example = {
  team: "Commerce QE",
  sprint: "Sprint 1",
  features: [
    {
      id: "checkout",
      title: "Checkout",
      module: "Orders",
      lifecycle: "active",
      evidence: {
        source: "docs/checkout.md",
        revision: "replace-with-source-revision",
        excerpt: "Replace with verified current behavior.",
      },
    },
  ],
  stories: [
    {
      id: "US-1",
      title: "Checkout order total",
      featureIds: ["checkout"],
      criteria: ["Order total matches the documented pricing rule"],
      evidence: {
        source: "ADO/US-1",
        revision: "1",
        excerpt: "Replace with actual acceptance criteria.",
      },
      boundaries: [],
      integrations: [],
    },
  ],
  cases: [
    {
      source: "ADO",
      externalId: "TC-1",
      revision: "1",
      title: "Place an order",
      featureIds: ["checkout"],
      storyIds: ["US-1"],
      steps: [
        { action: "Submit a valid cart", expected: "An order is created" },
      ],
      dependsOn: [],
    },
  ],
  documents: [],
};
export default function PlanningScreen({
  value,
  save,
}: {
  value?: Planning;
  save: (planning: Planning) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(JSON.stringify(value ?? example, null, 2)),
    [error, setError] = useState("");
  const report = assessPlanning(value ?? {});
  return (
    <section>
      <h1>Test intake & sprint planning</h1>
      <p>
        Bring manual cases, stories and application evidence together. This
        review queue does not change executable tests or production coverage.
      </p>
      <div className="panel" style={{ padding: 24 }}>
        <h2>1. Import your planning package</h2>
        <p>
          Export from ADO, Jira or another system and map to this JSON format.
          Preserve tracker IDs, revisions, steps and expected results. The
          example is illustrative; replace its evidence before saving. EDs can
          be supplied as documents with an explicit kind.
        </p>
        <label>
          Load a JSON package{" "}
          <input
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setDraft(await f.text());
            }}
          />
        </label>
        <label style={{ display: "block", marginTop: 16 }}>
          Team, sprint, features, stories, cases and documents
          <textarea
            aria-label="Planning package JSON"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={16}
            style={{ width: "100%", fontFamily: "monospace" }}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button
          className="button primary"
          onClick={async () => {
            try {
              const p = Schema.parse(JSON.parse(draft));
              if (await save(p)) setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Save & review intake
        </button>
        <p>
          Saving replaces this planning package. Merge exports before saving;
          duplicate source IDs are rejected. Credentials are never included in
          this package.
        </p>
      </div>
      <h2>2. Review existing manual cases</h2>
      <p>
        {value?.team || "No team saved"} · {value?.sprint || "No sprint saved"}
      </p>
      {report.triage.length === 0 && <p>No cases imported yet.</p>}
      {report.triage.map((t) => (
        <article
          className="panel"
          key={t.key}
          style={{ padding: 20, marginBottom: 12 }}
        >
          <h3>
            {t.key} · {t.title}
          </h3>
          <p>
            {t.scope} · {t.lifecycle}
          </p>
          {t.evidence.map((e, i) => (
            <p key={i}>
              Evidence: {e.source} @ {e.revision} — {e.excerpt}
            </p>
          ))}
          {t.cycle && (
            <p role="alert">
              Dependency cycle: replace shared prerequisites with independent
              setup fixtures or break the cycle before execution.
            </p>
          )}
          {t.dependencies.map((d) => (
            <p key={d.id}>
              Prerequisite {d.id}: {d.resolution}
            </p>
          ))}
        </article>
      ))}
      <h2>3. Review proposed coverage</h2>
      <p>
        Linked manual cases are traceability references, not proof that each
        technique is covered. Suggestions remain unverified until reviewed,
        implemented and executed.
      </p>
      {report.proposals.map((p) => (
        <article
          className="panel"
          key={p.storyId}
          style={{ padding: 20, marginBottom: 12 }}
        >
          <h3>
            {p.storyId} · {p.title}
          </h3>
          <p>
            Linked cases: {p.linkedCases.join(", ") || "None"} · {p.status}
          </p>
          <ul>
            {p.suggestions.map((s, i) => (
              <li key={i}>
                <strong>{s.technique}:</strong> {s.intent}
                <p>
                  Source: {s.evidence.source} @ {s.evidence.revision} —{" "}
                  {s.evidence.excerpt}
                </p>
              </li>
            ))}
          </ul>
          {p.questions.map((q) => (
            <p key={q}>Needs context: {q}</p>
          ))}
          {p.documentReviews.map((d) => (
            <p key={d.id}>
              {d.kind} / {d.id}: {d.action} Source: {d.evidence.source} @{" "}
              {d.evidence.revision} — {d.evidence.excerpt}
            </p>
          ))}
        </article>
      ))}
      <p>{report.notice}</p>
    </section>
  );
}
