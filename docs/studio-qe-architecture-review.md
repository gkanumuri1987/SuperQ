# Studio QE architecture review and usability upgrade

Reviewed 19 October 2026 against the mounted React Studio in `studio/App.tsx`, its outgoing requests and the local execution backend. This is an implementation review with controlled integration tests, not a live enterprise deployment assessment or a claim of complete application coverage.

The strongest part of SuperQ is its evidence → acceptance criterion → reviewed case → reusable action → execution chain. The main usability weakness was making QEs infer the next step across separate pages. The main confidence weakness was showing coverage without a clearly selected execution context. This upgrade prioritizes those problems and several maintenance/correlation defects before adding more AI agents.

## Workflow findings

| Workflow | Finding | Priority | Result |
|---|---|---|---|
| Starting and daily work | Setup, design gaps, blockers, review debt and execution tasks were scattered across screens | High | Implemented a filtered, prioritized work queue on Automate with direct actions to the relevant screen/test |
| Business scope | A reviewed passing case could make a requirement without any acceptance criteria appear proven | High | Such requirements now have an explicit gap and contribute neither complete automation coverage nor proven coverage |
| Before execution | Missing data, account secrets, saved SSO, custom adapters and skipped prerequisites often surfaced after starting a job | High | Added automatic configuration-only preflight with exact roots/prerequisites, predicted blocked/skipped cases and safe diagnostic references |
| Selection consistency | Launch maintenance checks used every suite case even when tags/shards excluded some | High | Launch and preflight share the runner's actual selection logic; filtered-out cases no longer create false maintenance blockers |
| Environment evidence | Studio chose a recent report without exposing its environment/suite/profile/account scope; loaded-source identity was not checked | High | Separate selectable evidence streams with current project, source and report identity checks |
| Latest attempt | A new failed/incomplete job could leave an older green report looking current | High | Latest non-draft attempt wins within its stream; stale/running/failed jobs cannot borrow older proof |
| Draft feedback | Failed exploratory trials could appear as ordinary review work | Medium | Current failed/flaky/healed trials produce investigation tasks before approval tasks; exploratory passes remain excluded from proof |
| Quick functional test | “Try this test” could associate a later unrelated job with the created case | High | Uses the exact returned job ID, environment and selected account, with visible run identity/time |
| Shared setup maintenance | Version comparison did not trace setup definitions or their nested locator changes | High | Before/after impact now includes setup workflows, their locators and dependent cases; staging copies the actual setup definitions and detects concurrent edits |
| Default run choices | The first configured suite could be empty and the first profile could be paid cloud | Medium | Default to a suite containing tests and a local profile when available; retain explicit cloud cost acknowledgement |
| Failures and reports | Structured diagnostics, private traces and independent assertion checkpoints exist | Medium | Retained; context views distinguish historical evidence and the work queue links investigation tasks to reports/repair review |
| Existing controls | Authenticated recording, shared setup reuse, source-bound intake, optional local agents, draft/review gates and promotion assessment | Existing strength | Regression-tested alongside this upgrade; no automatic QE approval, paid model fallback or production certification added |

## The easier daily workflow

1. Open **Automate** and work from **Your next steps**. Filter setup, design, automation, review, execution or maintenance work. The queue uses known requirements/tests; it does not infer undocumented business behavior.
2. Define or import missing expectations, map assertions and reuse/record interactions in **Start from sources**. A repo URL alone remains insufficient context.
3. Investigate failed trials and blockers before reviewing the saved definition. The queue opens the exact test editor for review work.
4. Open **Run**. Preflight updates automatically as context changes. Inspect exact selected roots, dependency cases and predicted outcomes. A compact readiness summary remains beside Start run.
5. Run and inspect diagnostics. Case-level blockers can still be recorded as blocked outcomes; preflight is not a live application check or a blanket guarantee that the run will pass.
6. Select the environment/suite/browser/account evidence stream on **Coverage**, **Requirements** or **Overview**. Historical reports remain available, while their passing checks do not become current proof after source/project changes. Coverage JSON exports include the selected evidence context.
7. Use **Change inbox** and **Catalog reuse** to maintain shared flows. Review changed expectations and setup/locator impacts, then stage drafts, review and rerun.

## Preflight scope and boundaries

`POST /api/runs/preflight` uses the same `prepareRun`/`selectTests` path as launch. It creates no job, starts no browser/cloud/model session and makes no application/tracker/database request. It checks configuration, Playwright executable presence for native local engines, exact filter/shard/dependency selection, assertion presence, adapter availability, account/secret references, required data variables, shared setup references, database credential names, configured cloud limits and saved-session presence.

Response variables become available only after the step that captures them; they are not inherited from another test or a prerequisite. Input values and process-secret values are not returned. A saved SSO snapshot proves only that an unexpired scoped file exists; application acceptance is checked during execution. Chrome/Edge channels, cloud permissions/tunnels, database read privileges, network access and actual business behavior still need runtime validation.

Global selection/source-review/maintenance blockers prevent starting from the Run dialog. Case-level blocked and skipped outcomes remain visible and may be recorded by execution. Existing direct execution APIs still produce runtime blocked/failed results; the preview does not replace adapter enforcement. Changing workspace revision invalidates a preview; refresh its context before saving. Source monitoring is not a live deployed-build attestation.

## Evidence semantics

Evidence streams are separate for environment, suite, browser profile and explicit account override. Per-case account selection remains bound to the project/test configuration. Only the latest non-draft attempt in a stream is considered; a later running/failed job does not fall back to an earlier success. Exploratory runs cannot supply proof.

Current proof requires a completed job, matching original project fingerprint, matching loaded planning/repository context, and the report fingerprint for that execution account. Missing legacy context fields fail closed. Partial selections are labeled; streams are never combined into a release-matrix certification. Mapped automation and proven checks are different measures. No acceptance criteria means no meaningful complete-coverage claim.

## Remaining gaps, in priority order

| Priority | Gap | Required next work / acceptance evidence |
|---|---|---|
| Enterprise blocker | Local trusted-user Studio token and typed reviewer name are not platform SSO, tenant RBAC, signed audit or isolated execution | Authenticated organization/project boundaries, server-enforced authorization, durable metadata/jobs, protected secrets/artifacts and adversarial tenant/isolation tests |
| High | Web traffic is currently restricted to application origin; CDN-hosted scripts and external app integrations may need additional origins | Explicit reviewed resource-origin policy and redirect/frame/popup tests; never infer or silently allow third-party origins |
| High | Source discovery supports bounded committed text, Gherkin/OpenAPI and mapped evidence; it does not understand every arbitrary application feature or prove that an assertion entails an ED | Curated real-app benchmark, feature/contract inventory, source provenance, uncertainty reporting and QE-validated semantic coverage; measure recall/precision rather than infer completeness |
| High | Tracker readers and mapped imports are not full Jira/ADO Test Plans synchronization | Paginated native inventory/suite adapters, revision conflicts, permissions, rate limits and real-tenant round-trip pilots |
| High | Cross-origin frames/popups, uploads/downloads and custom widgets lack guided recording/authoring support | Explicit supported command/scope models, isolation rules, real browser fixtures and clear unsupported-step blockers |
| High | Database/cloud/IdP/corporate-agent integration coverage is primarily local fixtures or configuration tests | Representative real systems and least-privilege identities, an approved cloud budget, tunnel connectivity, DB role/query-cost validation and recorded results |
| Medium | PostgreSQL/MongoDB/Snowflake need project/code configuration rather than a dedicated QE designer | Guided read-only query builders, typed result assertions, query bounds, data masking and connector-specific integration tests |
| Medium | Test data uses configurable overlays and per-attempt captures, without general seeded factories, cleanup/rollback or secret-vault provisioning | Versioned factories, ownership/lifecycle, cleanup on failure/cancel, isolation checks and explicit safe-retry semantics |
| Medium | Exact catalog/flow deduplication does not establish semantic equivalence or eliminate arbitrary code duplication | Conservative refactor suggestions, reviewed equivalence evidence and application-specific abstraction ownership |
| Medium | Local Ollama role workflow validates structure/citations, not reasoning correctness; live model quality is unmeasured | Installed-model evaluation set, incorrect-oracle/unsupported-behavior rejection rates, measured latency/resource cost and calibrated abstention |
| Medium | Reports lack native visual-baseline comparison and a complete grouped failure/retry workflow | Failure clustering with preserved evidence, context-preserving reruns, reviewed visual diffs and accessible diagnostic views |
| Medium | Metadata persistence and execution are one local process; large inventories and multiuser job operations are unproven | Durable queue, bounded workers, cancellation/recovery, storage quotas, inventory-scale load tests and protected CI artifacts |
| Planned | Mobile and performance execution | Separate adapters, environment/device/load configuration, workload safety budgets and measured quality gates after web/API workflows are validated |

## Verification and targets

Controlled tests cover exact filtered DAG selection, saved-variable ordering, secret-value omission, cloud limit/credential diagnostics without paid sessions, missing saved SSO, criteria-free false confidence, cross-environment/account evidence, stale source rejection, latest-job precedence, failed draft triage, the exact quick-test job, and shared-setup maintenance/staging/concurrent edits. Browser tests exercise work queue → Run → configuration preflight → real local API execution → selected evidence context, with desktop/mobile layout and browser-error checks. Existing recording, healing, auth, catalog, CLI, MCP and promotion regressions remain part of validation.

Measure these targets on a representative customer application next: time to first asserted trial, manual steps per automated case, percentage of preflight-detectable blockers caught before launch, false-positive/false-negative coverage suggestions, maintenance review effort, and clean execution reliability by context. Targets are not measured outcomes yet. Passing framework tests does not certify a customer application for production promotion.

## AI capability review and enhancement — 19 October 2026

This follow-up reviewed the active Studio assistance workflow, source intake, local coordinator and model transport, MCP permissions, runner/browser integration, coverage, healing, reporting and release controls. It combines repository review and controlled regression tests with primary-source documentation. It is not an exhaustive audit of every line or a live vendor comparison. Astra was requested for the review; the active conversation could not switch models through its tools, so this is not presented as an Astra-authored review.

### Trends that matter for SuperQ

| Observed capability | Implication for SuperQ | Delivery decision |
|---|---|---|
| Playwright documents planner, generator and healer agents, with a plan-to-test workflow ([official agents guide](https://playwright.dev/docs/test-agents)) | SuperQ already has corresponding bounded planning/design/review and healing capabilities. The opportunity is easier evidence review and trustworthy output | Improve proposal quality and diagnostics before adding autonomous loops |
| Agent evaluations assess tasks, trajectories and outcomes with suitable graders ([Anthropic evaluation guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)) | Model agreement alone is insufficient. Separate deterministic failures, business correctness and observed execution | Add repeatable adversarial contract tests and per-call metadata; a labeled live-model benchmark remains pending |
| Local structured generation can constrain output schemas ([Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)) | Schema validity helps interoperability but cannot establish correct business expectations | Retain explicit local model selection, bounded output and QE approval; add assertion checks after parsing |
| MCP guidance covers scope minimization, local-server risks and authorization boundaries ([official security guidance](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices)) | Corporate agents need narrow tools and explicit permissions; MCP is not an execution sandbox | Retain separate local agent credentials and no approval tool; remote authorization and worker isolation remain separate engineering work |

The product recommendation is **connect evidence → review suggested cases → map or record → inspect readiness → execute → maintain**. Keep AI quality inside that workflow rather than introducing another required dashboard or asking functional QEs to configure agent graphs.

### Implemented findings

| Finding | Change | Evidence |
|---|---|---|
| Whitespace-only cited excerpts could satisfy the nonempty string check and match whitespace in a source | Require nonblank excerpt text and nonblank source/revision | Invalid citations are rejected without changing the plan |
| Generated assertions could match every string or require contradictory static equalities on the same response field | Versioned deterministic proposal checks, also enforced in intake preflight and materialization | Known vacuous patterns and contradictory static values block; valid empty equality/false/zero/null and unresolved variable expectations remain supported |
| A renamed scenario could conceal a repeated flow; generic expected results were easy to overlook | Exact normalized-step/recipe duplicate review notes, vague-result prompts, status-only and missing-mapping notes | Reviewable suggestions retain candidate identity; no semantic-equivalence or complete-coverage claim |
| Coordination reported only a generic failure | Safe stage-specific failures and call count, duration, serialized input/output bytes, prompt digest and check version | Failure fixtures cover provider errors, excessive output, bad schema, citations, reviewer indices and cancellation |
| The coordinator cloned its inputs for staging but built later prompts from mutable original objects | Use the same frozen context for all roles and reference checks | Mutation during the analyst call cannot alter later role context; staging still rejects changed sources |
| Injected workers could return much larger output than the normal transport allowed | Bound serialized structured worker output to 100 KB before validation | Excess output fails without retaining raw worker content |
| QEs could not inspect/export the new quality evidence | Inline **AI proposal quality** panel in Start from sources, with downloadable JSON diagnostics | Browser integration checks actual panel rendering and downloaded content |

`npm run eval:ai` runs a deterministic fixture suite. It makes **no model calls** and measures contract enforcement, not model reasoning accuracy. The full `npm run check` includes it. The model reviewer receives lint findings; structural blockers stop before a reviewer call, while all accepted scenarios remain subject to QE review. A model's acceptance does not clear review notes automatically.

Quality checks are intentionally bounded: the generic-result detector covers a small English phrase list; duplicate matching is exact after whitespace normalization or exact recipe serialization; the regex check recognizes a short list of vacuous patterns. These are not semantic test deduplication, arbitrary regex analysis, proof that a cited sentence entails an assertion, or a hallucination detector. Empty substring checks are rejected as a policy for generated/mapped recipes; use explicit equality when an empty result is expected. Existing arbitrary code and project-level assertions are not globally rewritten by these checks.

The diagnostic export contains identifiers, configured model name, counts, fingerprints, durations and check codes. It omits raw prompts, source excerpts, candidate titles/values and model prose. The workspace still retains the source data and proposal content needed for QE review. Serialized byte counts are not token usage, provider billing or measured hardware cost. Model names are configured labels, not immutable model digest attestations. No automatic retraining or paid fallback was introduced.

### Prioritized product gaps and acceptance criteria

| Order | Enhancement | Why it matters / minimum acceptance evidence |
|---|---|---|
| 1 | Pilot benchmark with QE-labeled valid, ambiguous, contradictory, malicious and obsolete scenarios | Compare installed model versions on oracle correctness, useful unique cases, abstention, reviewer correction effort and seeded-defect detection. Run repeat trials and record actual model digest, latency and machine/provider cost. Current fixtures do not establish model accuracy |
| 2 | Single guided application pilot from inventory to first asserted test | Measure time to first useful automation, missing-context questions and manual edits. Deliver sample data/environment guidance and reusable domain templates; avoid making agent setup mandatory |
| 3 | Grounded impact and coverage discovery across stories, EDs and contracts | Source authority and revision must be visible. Distinguish observed implementation from intended behavior, expose contradictory requirements, and measure missed features against a labeled inventory |
| 4 | Failure grouping and context-preserving reruns | Cluster using operation/assertion/locator evidence; label root-cause suggestions as hypotheses. Preserve environment/account/browser/source identity, original failures and independent oracles |
| 5 | Advanced browser authoring and resource policy | Explicit iframe/popup/upload/download and third-party resource rules, accessible controls and controlled fixtures. Do not widen network access implicitly to make a model's flow pass |
| 6 | Native test inventory synchronization and DB validation designer | Paginated Jira/ADO suite import, revision conflicts and explicit publication; guided bounded queries and business reconciliation assertions. Prove against real tenants/databases |
| 7 | Enterprise deployment foundation | Platform SSO/RBAC, tenant isolation, signed reviewer/audit identity, secrets management, durable jobs, isolated workers and recovery. Application SSO/session capture does not satisfy platform identity requirements |
| 8 | Persistent evaluation history and reviewed learning | Store accepted/rejected/corrected suggestions with source and model identity; evaluate retrieval of approved reusable patterns on held-out tasks. Never silently turn previous generated guesses into authoritative requirements |
| 9 | Optional governed model routing | Corporate gateway/host integration with per-project data policies, budget accounting and explicit providers; choose models from measured task quality and cost. The user's Astra selection for a coding review does not configure an Astra API integration inside SuperQ |
| Later | Visual/accessibility checks, mobile and performance | Separate reviewed baselines and domain-specific outcome thresholds; functional pass rates cannot substitute for accessibility, load or mobile evidence |

The strongest current foundation is traceable, reviewed execution. The biggest remaining AI gap is **measured business correctness on real application tasks**, followed by source/inventory synchronization and enterprise isolation. More autonomous agents would amplify these gaps unless those foundations are validated first.
