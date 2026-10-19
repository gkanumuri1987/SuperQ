import { useState } from "react";
import type { workQueue, WorkItem } from "../src/work-queue";
import "./work-queue.css";
export default function WorkQueue({
  queue,
  open,
}: {
  queue: ReturnType<typeof workQueue>;
  open: (item: WorkItem) => void;
}) {
  const [expanded, setExpanded] = useState(false),
    [stage, setStage] = useState("all");
  const filtered = queue.items.filter(
      (i) => stage === "all" || i.stage === stage,
    ),
    shown = expanded ? filtered : filtered.slice(0, 4);
  return (
    <section className="work-queue" aria-labelledby="work-queue-title">
      <div className="work-queue-heading">
        <div>
          <span className="eyebrow">YOUR NEXT STEPS</span>
          <h2 id="work-queue-title">Make the next step clear.</h2>
          <p>
            {queue.counts.total} actions · {queue.counts.high} high priority.
            Start with blockers, then review and run.
          </p>
        </div>
        <label>
          Show work for
          <select
            aria-label="Work stage"
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setExpanded(false);
            }}
          >
            <option value="all">All stages</option>
            {["setup", "design", "automate", "review", "run", "maintain"].map(
              (s) => (
                <option value={s} key={s}>
                  {s}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      {!shown.length ? (
        <p>
          No actions in this view. Review your declared scope and run evidence
          before making a release decision.
        </p>
      ) : (
        <ol className="work-items">
          {shown.map((item) => (
            <li key={item.id}>
              <div>
                <span className={`work-priority ${item.priority}`}>
                  {item.priority} · {item.stage}
                </span>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </div>
              <button className="button" onClick={() => open(item)}>
                {item.action}
              </button>
            </li>
          ))}
        </ol>
      )}
      {filtered.length > 4 && (
        <button className="button" onClick={() => setExpanded(!expanded)}>
          {expanded
            ? "Show fewer actions"
            : `Show all ${filtered.length} actions`}
        </button>
      )}
      <small>{queue.scope}</small>
    </section>
  );
}
