import { coverage } from "./coverage.js";
import { projectFingerprint } from "./identity.js";
import type { Project } from "./model.js";
import type { WorkspaceState } from "./workspace-server.js";
/** Keep the latest attempt in each environment/suite/profile/account stream. Never merge streams or fall back to an older green run. */
export function studioEvidence(
  project: Project,
  jobs: WorkspaceState["runs"],
  sourceContext: string,
) {
  const latest = new Map<
    string,
    {
      job: (typeof jobs)[number];
      environment: string;
      suite: string;
      profile: string;
      user?: string;
    }
  >();
  for (const job of [...jobs].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  )) {
    if (job.draftValidation) continue;
    const config = job.configuration;
    const environment = config?.environment ?? job.report?.environment,
      suite = config?.suite ?? job.report?.suite,
      user = config?.user ?? job.report?.execution.user;
    if (!environment || !suite) continue;
    for (const profile of config
      ? [config.profile]
      : (job.report?.runs.map((r) => r.profile) ?? [])) {
      const key = JSON.stringify([environment, suite, profile, user ?? ""]);
      if (!latest.has(key))
        latest.set(key, { job, environment, suite, profile, user });
    }
  }
  const contexts = [...latest.entries()].map(
    ([key, { job, environment, suite, profile, user }]) => {
      const expected = projectFingerprint({
        ...project,
        execution: { ...project.execution, user },
      });
      const current =
        job.state === "completed" &&
        job.sourceFingerprint === projectFingerprint(project) &&
        job.sourceContext === sourceContext &&
        job.report?.provenance.projectFingerprint === expected;
      const results = current
        ? (job.report?.runs.find((r) => r.profile === profile)?.results ?? [])
        : [];
      return {
        key,
        runId: job.id,
        at: job.at,
        environment,
        suite,
        profile,
        user,
        state: job.state,
        current: !!current,
        partial:
          !!job.report &&
          (!!job.report.execution.testIds.length ||
            !!job.report.execution.includeTags.length ||
            !!job.report.execution.excludeTags.length ||
            !!job.report.execution.shard),
        coverage: coverage(project, results),
        results,
      };
    },
  );
  return {
    contexts,
    scope:
      "Latest non-draft attempt per environment, suite, browser profile and account. Historical, changed-source and exploratory runs do not supply current proof.",
  };
}
