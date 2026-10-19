import { useState } from "react";
import type { Snapshot } from "../src/knowledge";
import {
  inModule,
  previewModule,
  repositoryModules,
  suggestedDocuments,
} from "../src/module-scope";
export default function ModuleAnalysis({
  snapshot,
  pending,
  action,
}: {
  snapshot: Snapshot;
  pending: boolean;
  action: (path: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const inventory = snapshot.discovery?.inventory ?? [];
  const modules = repositoryModules(inventory);
  const [module, setModule] = useState(
    snapshot.discovery?.scope?.module ?? modules[0] ?? "",
  );
  const [documents, setDocuments] = useState(
    snapshot.discovery?.scope?.documents ??
      suggestedDocuments(inventory, module),
  );
  const [search, setSearch] = useState("");
  if (!modules.length) return null;
  const scope = { module, documents };
  const preview = previewModule(inventory, scope);
  const docs = inventory.filter(
    (f) =>
      f.kind === "documentation" &&
      f.path.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <details className="intake-candidate module-analysis">
      <summary>
        Focus on a module
        {snapshot.discovery?.scope
          ? ` · ${snapshot.discovery.scope.module}`
          : ""}
      </summary>
      <p>
        Choose one area of your application, review its files and supporting
        documents, then continue to test cases. Modules are grouped by
        repository folder; business boundaries and cross-module dependencies
        still need your review.
      </p>
      <label>
        Module to analyze
        <select
          value={module}
          onChange={(e) => {
            setModule(e.target.value);
            setDocuments(suggestedDocuments(inventory, e.target.value));
          }}
        >
          {modules.map((m) => (
            <option key={m} value={m}>
              {m === "." ? "Root-level files" : m}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>
          Supporting documentation ({documents.length} selected)
        </summary>
        <p>
          Suggestions use folder and filename matches, not verified business
          relevance. Documents inside the module are always included in scope.
          Add shared specifications for integrations when needed.
        </p>
        <label>
          Find documentation
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Document name"
          />
        </label>
        {docs.map((f) => (
          <label className="intake-check" key={f.path}>
            <input
              type="checkbox"
              checked={inModule(f.path, module) || documents.includes(f.path)}
              disabled={
                inModule(f.path, module) ||
                (!documents.includes(f.path) && documents.length >= 100)
              }
              onChange={(e) =>
                setDocuments((current) =>
                  e.target.checked
                    ? [...current, f.path]
                    : current.filter((p) => p !== f.path),
                )
              }
            />
            {f.path}
          </label>
        ))}
        {!docs.length && <p>No matching documentation found.</p>}
      </details>
      <section aria-label="Module scope preview">
        <h3>Preview before analysis</h3>
        <p>
          {preview.included.length} files · {preview.bytes.toLocaleString()}{" "}
          bytes · {preview.deferred.length} deferred by the size limit.
        </p>
        <p>
          Preview uses committed file sizes; unreadable files will be reported
          as skipped. This replaces the active analysis context. Existing tests
          stay saved; any plan based on different evidence must be reviewed
          again. Selecting a scope does not run tests or call an AI model.
        </p>
        <details>
          <summary>Files to load</summary>
          <ul>
            {preview.included.map((f) => (
              <li key={f.path}>
                {f.path} · {f.kind}
              </li>
            ))}
          </ul>
        </details>
        {!!preview.deferred.length && (
          <details>
            <summary>Files needing a smaller scope</summary>
            <ul>
              {preview.deferred.map((f) => (
                <li key={f.path}>{f.path}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {!preview.included.some((f) => f.kind === "source") && (
        <p role="status">
          No source files fit this scope. Choose a smaller folder or use
          explicit file selection.
        </p>
      )}
      <button
        className="button primary"
        disabled={pending || !preview.included.some((f) => f.kind === "source")}
        onClick={() =>
          void action("intake/focus", {
            scope,
            sourceRevision: snapshot.revision,
          })
        }
      >
        {pending ? "Loading module…" : "Use this module"}
      </button>
      {snapshot.discovery?.scope && (
        <button
          className="button"
          disabled={pending}
          onClick={() =>
            void action("intake/focus", {
              scope: null,
              sourceRevision: snapshot.revision,
            })
          }
        >
          Return to repository overview
        </button>
      )}
    </details>
  );
}
