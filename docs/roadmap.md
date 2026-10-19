# Delivery plan

## Phase 1 — foundation (this change)

Typed project model; evidence/requirement/test relationships; exact catalog deduplication; risk-weighted coverage and gaps; dependency-aware runner; global/environment/suite/test data; web/API and database adapter code; snapshot/diff; custom code API; read-only tracker functions; Cucumber example; AI budget/reference checks and healing proposal boundary; CI examples.

Acceptance: build and automated tests pass; real local browser/API flows pass and incorrect outcomes fail; unknown references and dependency cycles are rejected. External database/trackers remain unvalidated until configured.

## Phase 2 — first real application pilot

Choose one critical journey across UI → API → database and import a small set of QE cases and acceptance criteria. Add application-specific business actions, fixture factories and independent data assertions. Validate Postgres/Mongo/Snowflake with read-only accounts against disposable test datasets, including TLS, timeout, parameter-binding and permissions tests. Add OIDC/key-pair authentication where required. Keep missing specifications blocked.

Deliver a guided workspace for manual test authoring, evidence review, catalog reuse, environment/suite configuration, blockers and run details. Integrate Jira/ADO field mapping, pagination, revision conflicts, incremental sync, test-management plugins and separately authorized result publication. Configure source-change webhooks and persisted source/test lineage. Add OpenAPI and schema parsing for grounded impact analysis.

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
