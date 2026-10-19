import { useState } from "react";
import type { Project } from "../src/model";
type Definition = NonNullable<Project["webSetups"]>[string];
export default function SetupMaintenance({
  project,
  action,
}: {
  project: Project;
  action: (p: string, b: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <>
      <h3>Shared browser setups</h3>
      <p>
        Edits mark all referencing tests as drafts and invalidate plan review.
        Assertions stay in each test.
      </p>
      {Object.entries(project.webSetups ?? {}).map(([id, s]) => (
        <Editor
          key={id + JSON.stringify(s)}
          id={id}
          base={s}
          project={project}
          action={action}
        />
      ))}
      {!Object.keys(project.webSetups ?? {}).length && (
        <p>
          No shared setups yet. Extract a setup from a mapped case in Start from
          sources.
        </p>
      )}
    </>
  );
}
function Editor({
  id,
  base,
  project,
  action,
}: {
  id: string;
  base: Definition;
  project: Project;
  action: (p: string, b: Record<string, unknown>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(base)),
    [pending, setPending] = useState(false);
  const tests = project.tests.filter((t) =>
    t.steps.some(
      (s) => Array.isArray(s.input.setupIds) && s.input.setupIds.includes(id),
    ),
  );
  const update = (index: number, command: Definition["commands"][number]) =>
    setDraft({
      ...draft,
      commands: draft.commands.map((c, i) => (i === index ? command : c)),
    });
  return (
    <details>
      <summary>
        {base.title} ({id}) · {tests.length} referencing tests
      </summary>
      <p>
        {tests.map((t) => t.id).join(", ") ||
          "No tests reference this setup yet."}
      </p>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          try {
            await action("setups/update", { id, base, definition: draft });
          } finally {
            setPending(false);
          }
        }}
      >
        <label>
          Shared setup title
          <input
            required
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        {draft.commands.map((c, i) => (
          <fieldset key={i}>
            <legend>Setup command {i + 1}</legend>
            <label>
              Setup action
              <select
                aria-label={`Setup action ${i + 1}`}
                value={c.type}
                onChange={(e) => {
                  const type = e.target.value as
                    | "goto"
                    | "click"
                    | "fill"
                    | "selectOption"
                    | "check"
                    | "uncheck";
                  update(
                    i,
                    type === "goto"
                      ? { type, path: "/" }
                      : type === "fill" || type === "selectOption"
                        ? {
                            type,
                            locator:
                              "locator" in c
                                ? c.locator
                                : (Object.keys(project.locators)[0] ?? ""),
                            value: "",
                          }
                        : {
                            type,
                            locator:
                              "locator" in c
                                ? c.locator
                                : (Object.keys(project.locators)[0] ?? ""),
                          },
                  );
                }}
              >
                {[
                  "goto",
                  "click",
                  "fill",
                  "selectOption",
                  "check",
                  "uncheck",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            {"path" in c ? (
              <label>
                Setup path
                <input
                  aria-label={`Setup path ${i + 1}`}
                  required
                  value={c.path}
                  onChange={(e) => update(i, { ...c, path: e.target.value })}
                />
              </label>
            ) : (
              <label>
                Catalog control
                <select
                  aria-label={`Setup control ${i + 1}`}
                  value={c.locator}
                  onChange={(e) => update(i, { ...c, locator: e.target.value })}
                >
                  {Object.entries(project.locators).map(([key, l]) => (
                    <option value={key} key={key}>
                      {l.name ?? l.value} ({key})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {"value" in c && (
              <label>
                Configured value or data variable
                <input
                  aria-label={`Setup value ${i + 1}`}
                  value={c.value}
                  onChange={(e) => update(i, { ...c, value: e.target.value })}
                />
              </label>
            )}
            <button
              className="button"
              type="button"
              disabled={draft.commands.length <= 1}
              onClick={() =>
                setDraft({
                  ...draft,
                  commands: draft.commands.filter((_, n) => n !== i),
                })
              }
            >
              Remove setup command {i + 1}
            </button>
          </fieldset>
        ))}
        <button
          className="button"
          type="button"
          disabled={draft.commands.length >= 40}
          onClick={() =>
            setDraft({
              ...draft,
              commands: [
                ...draft.commands,
                {
                  type: "click",
                  locator: Object.keys(project.locators)[0] ?? "",
                },
              ],
            })
          }
        >
          Add setup command
        </button>
        <button className="button primary" disabled={pending}>
          Save setup and mark affected tests for review
        </button>
      </form>
    </details>
  );
}
