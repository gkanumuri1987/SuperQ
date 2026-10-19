# Review findings and production readiness

SuperQ is a developing automation framework. It is not currently certified for production promotion and cannot certify an application from its reference tests. This review found false-confidence paths in coverage, evidence and release gating; the changes below close specific paths and document the remaining boundaries.

## Findings addressed

| Priority | Gap found | Change and validation |
|---|---|---|
| High | A single passing linked test could mark a requirement proven while another approved case failed or was not executed | Coverage requires all approved linked automation to pass without flakes; explicit acceptance criteria must have asserted automation. Regression tests cover failed siblings and missing criteria |
| High | QE origin was treated as proof of QE review | Reviewer/time metadata and a digest bind review to test content, requirements and source evidence. Release checks reject missing or stale digests; audit reports review debt |
| High | Green reports had no application/artifact identity or automation provenance | Schema v2 records application SHA, artifact digest, automation SHA/dirty state, project fingerprint and execution start. Promotion rejects missing/mismatched identity and dirty automation |
| High | A filtered smoke run could be interpreted as release evidence | Required environment/suites/profiles are explicit; promotion rejects tags, test selection, shards, missing cases, duplicate results and mismatched browser metadata |
| High | No complete promotion policy or independent controls | Fail-closed assessment requires fresh complete evidence, clean first attempts, external checks and independent release-role approvals; it never deploys or issues certification |
| High | Saved percentages/gates could be edited and trusted later | Promotion validates raw result structure, re-evaluates coverage/policy and records digests rather than trusting report summaries |
| High | A hanging custom action could stall execution indefinitely | Step deadline sends a cooperative abort signal, records timeout, suppresses retry and stops queued work. Browser/API adapters respond to cancellation; process isolation remains necessary for uncooperative code |
| Medium | Immediate text reads could race UI rendering | `expectText` uses Playwright's retrying text assertion. Delayed-state and incorrect-expectation tests verify behavior |
| Medium | Multi-step API workflows could not reuse prior responses | `save` captures validated response fields into test/attempt-local variables; missing fields fail; reserved keys are rejected; values are omitted from reports |
| Medium | No actionable whole-project audit | `audit` reports prioritized acceptance-criteria, review, locator, assertion, blocker and duplicate gaps |
| Medium | AI was only a provider interface | Optional bounded local Ollama adapter supports structured proposals with reference validation; no model is silently selected/downloaded and no proposal becomes executable automatically |

The regression suite tests these controls with deliberately incomplete, stale and manipulated evidence. Passing these framework tests is evidence about these controls, not proof about an application under test.

## Recommended workflow

1. Define business requirements and acceptance criteria from approved evidence. Add boundary, negative, permissions, error, data integrity and recovery cases relevant to each criterion. Code discovery supplements these criteria; it cannot define business correctness alone.
2. Run `audit`; use the suggested next actions to resolve missing locators, weak assertions, review gaps and blockers. Add custom owned business actions where needed.
3. Review each test's actual expected outcomes and supporting evidence, then record the reviewer attestation. Commit reviewed configuration and code.
4. Use `plan`, then run complete suites against a representative test environment hosting the exact release artifact. Capture immutable application/artifact identity from trusted CI metadata.
5. Collect external security, performance, rollback and observability evidence for the same artifact. Add accessibility, migration or other controls to policy where needed.
6. Obtain separate QE and release-owner approval after the evidence completes. Run `promote` in a protected pipeline with controlled manifests and artifacts.
7. Use its decision as an input to the release process; check business risks and operational readiness and authorize rollout through your deployment system.

## Acceptance-criterion mapping and review

```json
{
  "requirements": [{
    "id": "REQ-CHECKOUT", "title": "Place an order", "risk": "critical",
    "evidenceIds": ["SPEC-1"],
    "criteria": [
      {"id": "AC-TOTAL", "title": "Persist the calculated order total"},
      {"id": "AC-AUTH", "title": "Reject unauthorized checkout"}
    ]
  }]
}
```

A test links `requirementIds` and declares `covers: {"REQ-CHECKOUT": ["AC-TOTAL"]}`. Mapping an ID does not prove that the assertions actually test the criterion; human review is still necessary. QE/AI origin and review are separate. After reviewing the test and evidence:

```sh
npm run superq -- review-test project.json TC-CHECKOUT --reviewer "Your name"
```

This command writes a local attestation and a digest, not an authenticated signature. It changes the case to approved. Changing the test definition, its linked requirements or evidence invalidates the digest. Commit before release execution; uncommitted automation is rejected by promotion. Release evidence must identify the application revision in its `applicationRevision` field, or use that SHA as the evidence revision. Documentation/tracker revisions can remain their actual source revision while `applicationRevision` records applicability reviewed for the release build.

## Production policy and evidence

Add the `release` object from [the policy snippet](../examples/release-policy.json) to a real project and configure its environment, suites and profiles. Thresholds default to 100% of declared requirements; blockers and missing review/criteria still block promotion independently of thresholds. This is deliberately stronger than exploratory run gates.

```sh
npm run superq -- run project.json qa regression \
  --profiles local,firefox,webkit \
  --application-revision <full-40-character-git-sha> \
  --artifact-digest sha256:<64-character-artifact-hash>
```

Identity flags are attestations supplied by the caller. SuperQ does not independently prove that the environment is serving that artifact. Your CI/deployment system must verify the deployed image/build digest and protect these values.

Use [the manifest shape](../examples/promotion.manifest.json), replacing placeholders. `reports` are paths relative to the manifest file. A check contains:

```json
{
  "id": "security", "status": "passed",
  "applicationRevision": "0000000000000000000000000000000000000000",
  "artifactDigest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "evidence": "https://your-protected-ci.example/build/security-result",
  "checkedAt": "2026-10-19T12:00:00Z"
}
```

An approval contains `reviewer`, `role`, `decision: "approved"`, the same application/artifact identity, and `at`. Required roles must use distinct reviewer identities; any explicit rejection blocks assessment. Checks, reports and release approvals must be fresh under `maxAgeHours`. Approvals must follow completion of all submitted evidence. Exactly one complete run is required for every required suite/profile pair. Multi-shard reports need aggregation support before they can be used here; current promotion rejects partial shard evidence.

```sh
npm run superq -- promote project.json release-manifest.json
```

The command writes `.superq/promotion.json`. Missing or invalid evidence exits nonzero. Even when every condition passes, the decision is `eligible-for-human-review`, with `certified: false`. It never deploys, merges or authorizes a promotion automatically. Digests allow controlled CI to archive exact inputs; they are not signatures and do not prevent an actor who controls the files from forging evidence. External-check URLs are recorded, not fetched or independently verified.

## Easier multi-step workflows

```json
{
  "action": "shared-api-request",
  "input": {"path": "/orders", "method": "POST", "body": {"sku": "known-fixture"}},
  "assertions": [{"path": "status", "operator": "equals", "expected": 201}],
  "save": {"createdOrderId": "body.id"}
}
```

A later step can use `/orders/${createdOrderId}` and assert persisted business values against an independently prepared fixture. Saved variables reset for each test attempt and never enter result artifacts. Captured values cannot replace reserved `superq.*` runtime keys. Avoid using an application's own calculated value as the only oracle for that same calculation.

For changing UI state use `{ "type": "expectText", "locator": "order-status", "value": "Confirmed", "timeoutMs": 5000 }` inside a web journey. Keep explicit step assertions as well. `execution.stepTimeoutMs` bounds an action; timeout fails the test, sends an abort signal and stops queued work without retrying the timed-out operation. Custom actions that ignore cancellation can continue running; use trusted handlers and a CI/job timeout until isolated workers are implemented. Synchronous blocking code cannot be preempted by a JavaScript timer.

## Optional local AI

```sh
# Install/start Ollama and choose/download an appropriate local model yourself.
npm run superq -- suggest project.json REQ-CHECKOUT --model <installed-local-model>
```

The adapter calls only an HTTP loopback origin, requests structured JSON, limits prompt/output sizes and has a bounded request deadline. Explicit cloud model names are rejected. Configure your Ollama daemon to disable cloud delegation (for example `OLLAMA_NO_CLOUD=1`) and review your daemon/model policy before sharing source. Loopback access alone cannot prove how a separately managed daemon processes data. A proxy or custom model alias can change that behavior.

Output is a draft with evidence and action references, questions and natural-language steps. It is not automatically added to the project. No per-call API charge is recorded by this local adapter; hardware/energy costs remain. Tests use a fake transport; no live model quality evaluation, model download or inference was performed. JSON schema conformance and known references do not establish factual correctness.

References: [Playwright retrying assertions](https://playwright.dev/docs/test-assertions), [Ollama structured output API](https://github.com/ollama/ollama/blob/main/docs/api.md).

## Remaining production blockers

- Live application pilot, mutation/seeded-defect evaluation and validation of database/cloud/tracker integrations.
- Signed CI attestations, authenticated approvals, RBAC, protected policy changes, artifact provenance and verification of the deployed artifact.
- Worker/process isolation, hard cancellation, distributed quotas and sharded report aggregation.
- Independent external security/performance/accessibility checks, data migration/reconciliation validation, operational dashboards, recovery drills and rollout controls.
- Sanitized attachments and historical analytics; richer JSON Schema/business assertions and representative data factories.

These are explicitly open. Do not use SuperQ's reference project or a green test count as production certification.


## Intake-to-automation gap review

Previously, sprint intake produced review suggestions while the execution builder required a separate manual translation. A guided path now connects repository-only, inventory-only and combined analysis to source-backed candidate review, visual action/oracle mapping, dependency/data/account preflight, content-bound plan review, reusable draft generation and actual local trials. Bounded command and assertion observations retain failed interaction/expectation locations without raw values. Trials remain exploratory and require subsequent saved-test review for normal execution.

The corporate-agent extension is a stdio MCP server with a dedicated local credential, revision checks, evidence-excerpt verification and optional reviewed-trial grant. It provides no approval, shell, generic project-edit or secret/session tools. This API capability boundary does not sandbox a host with other local permissions, authenticate the person entering a reviewer name, or establish enterprise tenancy. Native corporate Copilot/IdP/application pilots, evaluated semantic reasoning, full tracker synchronization and signed audit remain required. See [intake and agent guide](guided-intake-and-agents.md).
