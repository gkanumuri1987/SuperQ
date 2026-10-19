import { useState } from "react";
import type { WorkspaceState } from "../src/workspace-server";
export default function SetupFlows({
  state,
  disabled,
  action,
}: {
  state: WorkspaceState;
  disabled: boolean;
  action: (path: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [candidateId, setCandidate] = useState(""),
    [id, setId] = useState(""),
    [title, setTitle] = useState(""),
    [count, setCount] = useState(1),
    [existing, setExisting] = useState(""),
    [pending, setPending] = useState(false);
  const cases =
      state.intake?.candidates.filter((c) => c.recipe?.kind === "web") ?? [],
    selected = cases.find((c) => c.id === candidateId) ?? cases[0];
  const setups = Object.entries(state.project.webSetups ?? {});
  async function send(path: string, data: Record<string, unknown>) {
    setPending(true);
    try {
      await action(path, data);
    } finally {
      setPending(false);
    }
  }
  return (
    <details>
      <summary>Reusable browser setup flows</summary>
      <p>
        Share navigation and interactions before each test's own assertions.
        Setup runs in the same isolated browser and uses that case's account and
        configured data. Extract only setup steps; keep business validations in
        the case.
      </p>
      <label>
        Mapped case for setup
        <select
          value={selected?.id ?? ""}
          onChange={(e) => setCandidate(e.target.value)}
        >
          <option value="" disabled>
            Map a web case first
          </option>
          {cases.map((c) => (
            <option value={c.id} key={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      {selected?.recipe?.kind === "web" && (
        <ol>
          {selected.recipe.commands.map((c, i) => (
            <li key={i}>
              {c.type}
              {"locator" in c ? ` · ${c.locator.value}` : ""}
              {"path" in c ? ` · ${c.path}` : ""}
            </li>
          ))}
        </ol>
      )}
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void send("setups/extract", {
            candidateId: selected?.id,
            id,
            title,
            count,
          });
        }}
      >
        <label>
          New setup ID
          <input
            required
            pattern="[a-zA-Z][a-zA-Z0-9_.-]*"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="open-order-form"
          />
        </label>
        <label>
          Setup title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Open and prepare order form"
          />
        </label>
        <label>
          First commands to share
          <input
            type="number"
            min="1"
            max="40"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
        <button
          className="button"
          disabled={
            disabled ||
            pending ||
            !selected ||
            !!(
              selected.recipe?.kind === "web" &&
              selected.recipe.setupIds?.length
            )
          }
        >
          Extract setup and reference it in this case
        </button>
      </form>
      {!!setups.length && (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void send("setups/apply", {
              candidateId: selected?.id,
              id: existing || setups[0]?.[0],
            });
          }}
        >
          <label>
            Existing setup
            <select
              value={existing || setups[0]?.[0]}
              onChange={(e) => setExisting(e.target.value)}
            >
              {setups.map(([key, s]) => (
                <option key={key} value={key}>
                  {s.title} ({key}) · {s.commands.length} steps
                </option>
              ))}
            </select>
          </label>
          <button
            className="button"
            disabled={disabled || pending || !selected}
          >
            Use this setup in the mapped case
          </button>
          <p>
            Review the remaining case steps to remove repeated setup and
            preserve its intended starting state. Changing a shared setup
            invalidates reviews of every test that references it.
          </p>
        </form>
      )}
    </details>
  );
}
