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
  const expandedCount =
    selected?.recipe?.kind === "web"
      ? selected.recipe.commands.length +
        (selected.recipe.setupIds ?? []).reduce(
          (n, id) => n + (state.project.webSetups?.[id]?.commands.length ?? 0),
          0,
        )
      : 0;
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
          aria-label="Mapped case for setup"
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
      {selected?.recipe?.kind === "web" &&
        !!selected.recipe.setupIds?.length && (
          <div>
            <h3>Setup order</h3>
            <ol>
              {selected.recipe.setupIds.map((id, index) => (
                <li key={id}>
                  <strong>{state.project.webSetups?.[id]?.title ?? id}</strong>{" "}
                  · {id}
                  <button
                    className="button"
                    type="button"
                    aria-label={`Move setup ${id} earlier`}
                    disabled={disabled || pending || index === 0}
                    onClick={() => {
                      if (selected.recipe?.kind !== "web") return;
                      const setupIds = [...selected.recipe.setupIds!];
                      [setupIds[index - 1], setupIds[index]] = [
                        setupIds[index]!,
                        setupIds[index - 1]!,
                      ];
                      void send("setups/order", {
                        candidateId: selected.id,
                        setupIds,
                      });
                    }}
                  >
                    Move earlier
                  </button>{" "}
                  <button
                    className="button"
                    type="button"
                    aria-label={`Move setup ${id} later`}
                    disabled={
                      disabled ||
                      pending ||
                      index ===
                        (selected.recipe?.kind === "web"
                          ? selected.recipe.setupIds!.length
                          : 0) -
                          1
                    }
                    onClick={() => {
                      if (selected.recipe?.kind !== "web") return;
                      const setupIds = [...selected.recipe.setupIds!];
                      [setupIds[index], setupIds[index + 1]] = [
                        setupIds[index + 1]!,
                        setupIds[index]!,
                      ];
                      void send("setups/order", {
                        candidateId: selected.id,
                        setupIds,
                      });
                    }}
                  >
                    Move later
                  </button>
                </li>
              ))}
            </ol>
            <button
              className="button"
              disabled={disabled || pending || expandedCount > 100}
              onClick={() =>
                void send("setups/inline", { candidateId: selected.id })
              }
            >
              Make setup steps editable in this case
            </button>
            {expandedCount > 100 && (
              <p>
                The editable copy would contain {expandedCount} commands. Keep
                shared references or split the case to stay within the
                100-command limit.
              </p>
            )}
            <p>
              This copies all setup steps into the case in their current order.
              Shared definitions stay in the catalog. Case assertions and data
              variables are preserved; plan review is cleared.
            </p>
          </div>
        )}
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
              aria-label="Existing setup"
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
            disabled={
              disabled ||
              pending ||
              !selected ||
              (selected.recipe?.kind === "web" &&
                (selected.recipe.setupIds?.includes(
                  existing || setups[0]?.[0] || "",
                ) ||
                  (selected.recipe.setupIds?.length ?? 0) >= 4))
            }
          >
            Add this setup to the mapped case
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
