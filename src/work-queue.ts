import type { WorkspaceState } from "./workspace-server.js";
import type { studioEvidence } from "./studio-evidence.js";
import { hasAutomation } from "./coverage.js";
import { projectFingerprint, isReviewCurrent } from "./identity.js";
export type WorkItem = {
  id: string;
  priority: "high" | "medium";
  stage: "setup" | "design" | "automate" | "review" | "run" | "maintain";
  title: string;
  detail: string;
  target: string;
  testId?: string;
  action: string;
};
export function workQueue(
  state: WorkspaceState,
  evidence: ReturnType<typeof studioEvidence>,
  sourceContext: string,
) {
  const items: WorkItem[] = [],
    p = state.project;
  const add = (item: WorkItem) => items.push(item);
  if (state.sample)
    add({
      id: "sample",
      priority: "medium",
      stage: "setup",
      title: "Connect your application",
      detail:
        "This is the sample workspace. Configure real application evidence and environment URLs when ready.",
      target: "connections",
      action: "Set up application",
    });
  if (!p.requirements.length)
    add({
      id: "requirements",
      priority: "high",
      stage: "design",
      title: "Define what must be tested",
      detail:
        "Add acceptance criteria or import a manual inventory before generating automation.",
      target: "intake",
      action: "Add source evidence",
    });
  if (state.connections.repository && !state.sourceSnapshot)
    add({
      id: "source",
      priority: "medium",
      stage: "setup",
      title: "Load application knowledge",
      detail:
        "A repository URL alone supplies no code context. Configure a local read-only checkout and allowed committed files.",
      target: "connections",
      action: "Configure source scan",
    });
  const pending = new Set(
    state.plan?.items
      .filter((i) => i.status === "pending")
      .map((i) => i.testId) ?? [],
  );
  for (const test of p.tests) {
    const common = { testId: test.id };
    if (pending.has(test.id)) {
      add({
        ...common,
        id: `maintenance:${test.id}`,
        priority: "high",
        stage: "maintain",
        title: `Review changes to ${test.title}`,
        detail:
          "Application changes affect this case. Resolve its change proposal before execution.",
        target: "maintenance",
        action: "Review source changes",
      });
      continue;
    }
    if (test.blockedBy.length) {
      add({
        ...common,
        id: `blocked:${test.id}`,
        priority: "high",
        stage: "automate",
        title: `Unblock ${test.title}`,
        detail: test.blockedBy.join("; "),
        target: "tests",
        action: "Resolve case blockers",
      });
      continue;
    }
    if (!test.steps.length || !test.steps.some((s) => s.assertions.length)) {
      add({
        ...common,
        id: `map:${test.id}`,
        priority: "high",
        stage: "automate",
        title: `Automate ${test.title}`,
        detail:
          "This case needs executable steps and explicit expected results. Start from its manual evidence.",
        target: "intake",
        action: "Map actions and assertions",
      });
      continue;
    }
    const latest = state.runs.find(
      (job) =>
        job.state === "completed" &&
        job.sourceFingerprint === projectFingerprint(p) &&
        job.sourceContext === sourceContext &&
        job.report?.results.some((r) => r.id === test.id),
    );
    const recent = latest?.report?.results.find((r) => r.id === test.id);
    if (
      recent &&
      (recent.status !== "passed" || recent.healed || recent.flaky)
    ) {
      add({
        ...common,
        id: `trial:${test.id}`,
        priority: "high",
        stage: recent.healed ? "maintain" : "run",
        title: `Investigate ${test.title}`,
        detail: `${latest!.report!.environment} / ${recent.profile}: ${recent.healed ? "speculative repair needs review" : recent.status}${recent.reason ? ` · ${recent.reason}` : ""}${latest!.draftValidation ? " · exploratory trial; not release proof" : ""}`,
        target: recent.healed ? "quality" : "runs",
        action: recent.healed
          ? "Review repair evidence"
          : "Inspect run results",
      });
      continue;
    }
    if (!isReviewCurrent(p, test) || test.status !== "approved") {
      add({
        ...common,
        id: `review:${test.id}`,
        priority: "medium",
        stage: "review",
        title: `Review ${test.title}`,
        detail:
          "Validate business expectations, evidence and the latest test definition. Trial results alone are not approval.",
        target: "tests",
        action: "Review test definition",
      });
      continue;
    }
    const outcomes = evidence.contexts
      .filter((c) => c.current)
      .flatMap((c) =>
        c.results.filter((r) => r.id === test.id).map((r) => ({ r, c })),
      );
    const problem = outcomes.find(
      (o) => o.r.status !== "passed" || o.r.healed || o.r.flaky,
    );
    if (problem)
      add({
        ...common,
        id: `result:${test.id}`,
        priority: "high",
        stage: problem.r.healed ? "maintain" : "run",
        title: `Investigate ${test.title}`,
        detail: `${problem.c.environment} / ${problem.c.profile}: ${problem.r.healed ? "speculative repair needs review" : problem.r.status}${problem.r.reason ? ` · ${problem.r.reason}` : ""}`,
        target: problem.r.healed ? "quality" : "runs",
        action: problem.r.healed
          ? "Review repair evidence"
          : "Inspect run results",
      });
    else if (hasAutomation(test) && !outcomes.length)
      add({
        ...common,
        id: `run:${test.id}`,
        priority: "medium",
        stage: "run",
        title: `Run ${test.title}`,
        detail:
          "No current non-draft result matches this project and loaded source context.",
        target: "runs",
        action: "Choose run context",
      });
  }
  for (const req of p.requirements) {
    if (!req.criteria.length)
      add({
        id: `criteria:${req.id}`,
        priority: "high",
        stage: "design",
        title: `Clarify ${req.title}`,
        detail:
          "Define independent acceptance criteria so coverage has a meaningful denominator.",
        target: "requirements",
        action: "Define acceptance criteria",
      });
    else {
      const missing = req.criteria.filter(
        (c) => !p.tests.some((t) => t.covers[req.id]?.includes(c.id)),
      );
      if (missing.length)
        add({
          id: `gap:${req.id}`,
          priority: "high",
          stage: "design",
          title: `Cover ${req.title}`,
          detail: `Unmapped acceptance criteria: ${missing.map((c) => c.title).join("; ")}`,
          target: "intake",
          action: "Generate or map missing cases",
        });
    }
  }
  const incomplete = state.runs.find(
    (r) =>
      r.state === "failed" &&
      r.sourceFingerprint === projectFingerprint(p) &&
      r.sourceContext === sourceContext,
  );
  if (incomplete)
    add({
      id: `job:${incomplete.id}`,
      priority: "high",
      stage: "run",
      title: "An execution could not complete",
      detail: incomplete.error ?? "Inspect the failed job before retrying.",
      target: "runs",
      action: "Inspect execution setup",
    });
  if (state.sourceAlerts?.length && !pending.size)
    add({
      id: "source-alerts",
      priority: "high",
      stage: "maintain",
      title: "Review newly changed source",
      detail: `${state.sourceAlerts.length} source files changed; inspect scope even if no existing case is mapped.`,
      target: "maintenance",
      action: "Open change inbox",
    });
  const order = {
    maintain: 0,
    setup: 1,
    design: 2,
    automate: 3,
    review: 4,
    run: 5,
  };
  items.sort(
    (a, b) =>
      (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1) ||
      order[a.stage] - order[b.stage] ||
      a.id.localeCompare(b.id),
  );
  return {
    items,
    counts: {
      high: items.filter((i) => i.priority === "high").length,
      total: items.length,
    },
    scope:
      "Actions for declared requirements and tests. This queue does not establish complete application coverage or production readiness.",
  };
}
