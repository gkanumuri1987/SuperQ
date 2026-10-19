# Delivery plan

## Phase 1 — foundation (this change)

Typed project model; evidence/requirement/test relationships; exact catalog deduplication; risk-weighted coverage and gaps; dependency-aware runner; global/environment/suite/test data; web/API and database adapter code; snapshot/diff; custom code API; read-only tracker functions; Cucumber example; AI budget/reference checks and healing proposal boundary; CI examples.

Acceptance: build and automated tests pass; real local browser/API flows pass and incorrect outcomes fail; unknown references and dependency cycles are rejected. External database/trackers remain unvalidated until configured.

## Phase 2 — first real application pilot

Choose one critical journey across UI → API → database and import a small set of QE cases and acceptance criteria. Add application-specific business actions, fixture factories and independent data assertions. Validate Postgres/Mongo/Snowflake with read-only accounts against disposable test datasets, including TLS, timeout, parameter-binding and permissions tests. Add OIDC/key-pair authentication where required. Keep missing specifications blocked.

Extend the local Studio workspace with team workflows, authenticated connections and richer native configuration designers. Integrate Jira/ADO field mapping, pagination, revision conflicts, incremental sync, test-management plugins and separately authorized result publication. Configure source-change webhooks and persisted source/test lineage. Add OpenAPI and schema parsing for grounded impact analysis.

Acceptance: every pilot criterion has an owner and reviewed test or documented exception; deliberate application defects are caught; results can be traced to exact application and automation revisions; source credentials cannot write.

## Phase 3 — evaluated AI assistance

Connect an approved model gateway after source/data review. Build a labeled evaluation set of supported, ambiguous, contradictory and malicious inputs. Implement structured executable proposals, compile checks, action retrieval, semantic duplicate review and human-approved automation PRs. Persist budgets, prompt/model versions, proposal decisions and provenance. Introduce healing only after collecting actual failure evidence and measuring false repairs.

Acceptance: unsupported references never reach execution, uncertain scenarios ask questions, assertions are never weakened automatically, malicious repository instructions cannot invoke tools, provider spend respects hard limits. Track factual grounding and reviewer acceptance; do not claim zero hallucinations.

## Phase 4 — enterprise operations

Durable orchestration and cancellable isolated workers; bounded concurrency; per-tenant RBAC; secrets integration; audit log; rich sanitized traces/screenshots; JUnit/HTML reporting; flaky classification; test impact analysis; scheduled suites; accessibility/security extensions; reproducible fixtures and test-data cleanup; database reconciliation with precision, null, timezone, duplicate and eventual-consistency rules; worker image and dependency hardening.

Acceptance: fault-injection and concurrency tests pass; retries retain original failures; role isolation and artifact redaction verified; backups, rollback and cost alerts exercised. Establish measured reliability and runtime SLOs with the pilot team.

## Phase 5 — additional execution domains

Appium-based mobile adapters with device-farm orchestration; k6 performance plans with workload models and explicit performance budgets. Reuse requirements, evidence, catalog, fixtures and results while keeping domain-specific assertions. Performance success must use measured latency/error/throughput thresholds, not functional pass counts.

## Measures of success

Risk coverage over reviewed acceptance criteria; mutation/seeded-defect detection; escaped defects; useful accepted tests per model dollar; flaky failure rate; mean triage time; catalog reuse and duplicate reduction; source-to-test freshness; blocked-test age; pipeline duration. Define baseline and targets after the pilot, rather than advertising unmeasured industry superiority.


## Execution and usability follow-up (implemented)

Named local Chromium/Firefox/WebKit/Chrome/Edge profiles; BrowserStack and LambdaTest capability mapping; explicit cloud selection and per-process concurrency caps; bounded dependency-aware parallel scheduling; tags/test selection; stable root sharding; opt-in safe retries with attempt history and flaky gates; max-failure stopping; runtime fixture identifiers; init/doctor/plan commands; multi-view HTML, JSON, JUnit and Markdown reports; coverage thresholds and CI artifact publication.

Still required for enterprise rollout: live cloud account/tunnel validation; native vendor status publication; distributed session quotas; shard result aggregation; sandboxed workers/cancellation; secrets integration; sanitized screenshots/traces/video; historical trends and Allure/ReportPortal bridges; guided test-authoring/configuration UI; data factories and cleanup; richer assertions (JSON Schema, accessibility, visual comparison, reconciliation tolerances); scheduled runs and ownership/quarantine workflows. Mobile and performance remain later execution domains. These capabilities should be measured against the pilot rather than described as complete.


## Whole-tool review and readiness hardening (implemented)

Acceptance-criterion mappings; explicit reviewer attestations tied to test/spec/evidence digests; all-approved-case coverage semantics; schema v2 report provenance; exact artifact/application identities; fresh complete release-matrix assessment; external-check and independent approval requirements; re-evaluation of raw evidence; step deadlines/cooperative cancellation; response capture; web-first text assertions; actionable audit; optional bounded loopback Ollama drafts; billing-violation disablement; loaded knowledge content hash verification; strict typechecking for tests/examples.

Promotion remains `eligible-for-human-review` or `blocked`, never certification. Authentication/signing, protected CI provenance, deployed artifact verification, live integration pilots, hard worker isolation and operational validation remain open. See the detailed review document for the boundary of each implemented control.


## Guided Studio workspace (implemented)

React/Vite local workspace with setup wizard, requirements, visual API/browser test builder, reviewed drafts, shared catalogs, coverage map, real execution/report views, local AI drafts, version comparison, change proposals, manual resolution and recoverable project history. Read-only allowlisted Git monitoring surfaces committed changes/deletions and unknown source impact. Scoped mutations use request tokens and revision checks. See the Studio UX guide for supported workflows and remaining enterprise/native-design increments.

## Competitive review and coverage design (implemented)

See [the primary-source landscape review](competitive-review.md) for the current delivery order and measurable exits. Coverage Lab adds bounded deterministic pairwise datasets, explicit forbidden combinations, feasible-obligation counts, unreachable-value diagnostics, source context, local model persistence and JSON exports. It is available through Studio and CLI, uses no LLM call, and never inflates application coverage. Native tracker sync, semantic knowledge analysis and evaluated intent-to-executable generation remain the next substantial milestones.

## Product priority: easy functional automation

The default Automate screen and simplified navigation now put common functional checks ahead of specialist configuration. Business expectations and application setup are prerequisites; QE authors do not need to choose catalog action IDs, locator IDs, workers or browser capabilities for the shortcut. Subsequent work should prioritize recorder-assisted capture and direct manual-case-to-working-test flow, with measured reviewer effort and correction rates, before adding more top-level tools. See [the workflow](easy-automation.md).

## Environment-scoped application users and data (implemented)

Studio setup now manages application roles, environment accounts/defaults, separate web/API URLs, environment data and form login. Execution resolves role requirements, selected accounts and process secret references; bearer headers, login contexts, typed data and locator substitutions are environment-aware. Per-suite/per-case environment overlays and named HTTP service URLs are available in project configuration. This is not SuperQ platform RBAC or SSO/MFA provisioning. Database connection secrets remain on the existing process-level adapter configuration.

## Application SSO/MFA (implemented)

Guided local sign-in now supports human completion of provider SSO/MFA, scoped expiring browser snapshots, per-journey identity-page checks, local session deletion and a CLI capture command. A capture proxy restricts configured HTTP origins and HTTPS tunnel destinations, including redirects. Configured two-stage form login supports per-account TOTP seed references with RFC-vector tests. No provider enrollment, SMS retrieval, push approval, OAuth API token broker or SuperQ platform SSO/RBAC is implied. Live provider/device/policy compatibility and distributed account leasing remain pilot work. See [SSO/MFA setup](sso-mfa.md).
