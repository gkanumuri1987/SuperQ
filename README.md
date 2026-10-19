# SuperQ

Evidence-driven automation for quality engineering teams. SuperQ keeps application source read-only and owns its test catalog, assertions, data and execution in a separate repository.

**Status: runnable foundation, not a finished enterprise platform.** Web and API execution are demonstrated locally. PostgreSQL, MongoDB and Snowflake adapters and Jira/ADO read connectors need integration validation with your systems. AI supports optional local Ollama proposals and a provider interface. Optional catalog-based local healing retains failures and requires reviewed repair plus a clean rerun; no autonomous learning, model subscription or paid calls are enabled.

## Open the guided Studio

```sh
npm ci
npx playwright install chromium
npm run studio
```

Open `http://127.0.0.1:4310` to start with **Automate**: choose an expectation, add the interaction and try the test. Common functional screen/API checks reuse framework configuration automatically. Specialist screens stay under **More tools**. See the [simple functional workflow](docs/easy-automation.md). The change inbox shows affected tests with before/after validation, locator, workflow and functionality comparisons. Stage updates as drafts, record review, and run again. Optional allowlisted local Git monitoring detects committed changes while Studio is open. The initial workspace is a clearly labeled interactive sample. See the [Studio workflow guide](docs/studio-ux.md). Intake & sprint planning also accepts mapped manual-test exports with team, sprint, feature lifecycle, story, dependency and document evidence. See [sprint intake](docs/sprint-intake.md) for the format and current limits.

## Start from repositories, manual tests or both

Studio → **Start from sources** prepares a reviewable automation plan from committed sources, manual inventory or both. Paste spreadsheet cases, map API requests or ordered web interactions, resolve data/accounts/dependencies, approve the plan, generate reusable drafts and run an actual local trial. Source/configuration changes invalidate old plan approval; command and assertion diagnostics retain failed steps. See [guided intake and corporate agents](docs/guided-intake-and-agents.md).

The included **stdio MCP server** lets a permitted corporate Copilot or another MCP-capable host read shared evidence, propose cited scenarios/mappings and optionally run separately authorized reviewed trials. It cannot approve plans through its tools. Corporate model access remains with the host; no model subscription or paid call is enabled by SuperQ. Platform authentication/isolation remains enterprise work.

## Automation care

Top shortcuts now connect generation, catalog reuse, reports, feature coverage and **Quality & maintenance**. Configure bounded local healing, inspect package/lockfile/browser health, and review duplicate-flow candidates. Intake can generate from documented criteria with no tests and enhance an existing empty manual case while preserving its ID/data. Guided Playwright flows also support dropdowns, checkboxes, URL/value/visibility/count assertions and independent checkpoints. See [setup and boundaries](docs/automation-care.md).

## Recording, traces and local agents

**Start from sources** can record anonymous web interactions into an editable, catalog-backed draft. Entered values become test-data placeholders; expected results come from the QE. **Run** offers opt-in private Playwright traces with authenticated downloads and expiry. Optional local Ollama coordination runs separate analyst, designer and reviewer calls, then stages evidence-backed proposals for QE review. See [workflow, limits and validation](docs/recording-traces-and-agents.md).

## Run locally

Requires Node.js 22.12+ and Git.

```sh
npm ci
npx playwright install chromium
npm run check
npm run demo
npm run reference-app
```

In another terminal:

```sh
npm run superq -- validate examples/project.json
npm run superq -- run examples/project.json local smoke
npm run superq -- run examples/project.json local browser
npm run bdd
```

Execution writes `.superq/report.json` and uniquely named report directories under `.superq/runs/`. Any failed, blocked or skipped selected test produces a nonzero exit status. `analyze` is informational and reports gaps without running tests. Tests without explicit assertions cannot pass. Each browser journey has an isolated browser context; API calls are stateless. Share business setup through fixtures and test data rather than dependent mutable sessions.

## Production readiness and gap review

Run `npm run superq -- audit project.json` for prioritized gaps. Explicit acceptance criteria, reviewer attestations bound to test/evidence content, and stronger coverage rules prevent a single happy-path pass from hiding failed linked tests. Step deadlines, response capture and retrying UI text assertions improve real workflows.

A separate `promote` assessment requires a release policy, complete fresh suite/browser evidence, immutable build identities, external checks and independent approvals. It never deploys or certifies an application. See the [full review and readiness guide](docs/review-and-production-readiness.md) for findings, commands and remaining production blockers.

Optional local AI is now available through `suggest project.json REQ-ID --model <installed-local-model>` using Ollama. No model is automatically selected or downloaded; generated drafts still require QE review.

## What is implemented

| Area | Foundation behavior |
|---|---|
| Traceability | Evidence → requirements → QE/AI tests → shared actions → results |
| Coverage | Missing QE review, approval, asserted automation and blockers; risk-weighted mapped vs passed coverage |
| Reuse | Unique action IDs, operation handlers and locator definitions; identical step sequences flagged as duplicate candidates |
| Execution | Selectable local/cloud Playwright browser profiles, web/API, SELECT adapters for PostgreSQL/Snowflake, bounded MongoDB find, custom TypeScript handlers |
| Data | Global → environment → suite → test overrides; `${key}` interpolation preserves exact-value types |
| Dependencies | Cycles rejected; bounded parallel workers; prerequisite failures block descendants; explicit blockers recorded |
| Knowledge | Explicit tracked-file snapshots at committed revisions, hashes and change reports; no source writes |
| AI controls | Provider interface, evidence reference validation, bounded reservations, in-process cache, no retry loops |
| Healing | Opt-in bounded local locator alternatives; original failure retained; staged draft repairs and clean-rerun gates |
| Capture & diagnostics | Anonymous web recording, explicit oracles, private opt-in native Playwright traces |
| Agent coordination | Three bounded local Ollama roles; cited proposals, independent review, cancellation and stale-input rejection |
| BDD | Runnable Cucumber scenario reuses the same catalog and execution engine |
| Trackers | Programmatic read-only Jira Cloud issue and Azure DevOps work-item connectors |
| CI | GitHub Actions and Azure Pipelines examples |

## Browser matrix, parallel runs and report views

```sh
npx playwright install chromium firefox webkit
npm run superq -- doctor examples/project.json
npm run superq -- plan examples/project.json local regression --profiles local,firefox,webkit
npm run superq -- run examples/project.json local regression --profiles local,firefox,webkit --workers 2
```

Start the reference app before `run`. Choose Chromium, Firefox, WebKit or installed Chrome/Edge; configure BrowserStack and LambdaTest profiles using environment credentials. Reports offer interactive summary, test, coverage, blocker and browser views, plus JSON, JUnit and Markdown. Tags, stable CI sharding, safe retries and coverage gates are configurable. See the [execution guide](docs/execution-and-reporting.md) for copyable configuration and limits.

`init <project.json>` creates a starter; `doctor` checks setup; `plan` previews selection without paid sessions.

## Configure your application

Copy `examples/project.json`. Replace reference evidence with your real acceptance criteria and source revisions. Add requirements and test cases, then reuse catalog action IDs and centralized locators. Keep AI suggestions as `draft` until QE review; evidence references prove provenance, not truth. The reference data reconciliation case deliberately lacks a specification and remains blocked.

Action operation signatures:

- `api:request`: `{path, method?, body?, headers?}` → `{status, body}`. Same-origin only, redirects disabled.
- `web:journey`: `{commands: [{type: 'goto', path}, {type: 'fill', locator, value}, {type: 'click', locator}, {type: 'text', locator}]}` → `{url, text}`. Text values use locator IDs as keys. Third-party browser requests are blocked in this version; federated sign-in uses the separately configured SSO/MFA capture workflow; normal journeys reuse scoped sessions.
- `postgres:query`: `{query, params?}` → `{rows, rowCount}`. Use `$1` parameter binding.
- `snowflake:query`: `{query, params?}` → `{rows, rowCount}`. Use `?` binding and an explicitly configured read-only role.
- `mongo:find`: `{database, collection, filter?, limit?}` → `{rows, rowCount}`. Maximum 1,000 rows, 30-second query limit.

All assertions use `{path, operator, expected?}` with dotted object/array paths. Operators: `equals` (deep equality), `contains`, `matches`, `exists`. These are immediate result assertions; custom Playwright handlers should use Playwright's web-first assertions for eventually changing UI. No automatic weakening of expected values is supported.

Database secrets are environment variables listed in `.env.example`. Enforce read-only roles at the database, restrict accessible schemas/collections and use a non-production account. SELECT can invoke functions: the SQL guard is not a security boundary. Snowflake warehouse auto-suspend, query/statement limits and resource monitors should be configured by your administrator. The reference adapters are not an unrestricted query console.

### Extend with code

```ts
import { Registry, run } from './src/runner.js';
const registry = new Registry().register('custom:verifyInvoice', async (input, context) => {
  // Implement an owned business adapter; return structured evidence for assertions.
  return { total: context.data.expectedTotal };
});
// Add a catalog action with kind=custom, operation=verifyInvoice.
// await run(validatedProject, 'qa', 'regression', registry);
```

Custom code is trusted code with process permissions; it is not sandboxed. The CLI uses built-in adapters; custom registries are used through the programmatic API. Add assertions that independently verify application behavior, rather than returning an expected input as the real implementation.

### Refresh knowledge without editing the application

```sh
npm run superq -- snapshot /path/to/application .superq-before.json README.md src/contracts.ts
# After application changes are committed:
npm run superq -- snapshot /path/to/application .superq-after.json README.md src/contracts.ts
npm run superq -- diff .superq-before.json .superq-after.json
```

Pass all paths in scope for each snapshot; omission is interpreted as removal. Files must be tracked, committed, small text files within the repository. The explicit path list and filename guards reduce accidental exposure but do not detect every secret. Review source before sharing evidence with a model. Snapshot output contains code; store it privately. CLI snapshots are explicit; Studio also supports optional committed-source monitoring while its local server is running.

### AI and tracker extension points

`src/ai.ts` accepts a `ModelProvider`. Use your organization's model gateway to enforce a hard per-call budget and return actual cost. Call `Planner.propose` with a project, requirement ID and maximum reserved cost. An optional local Ollama adapter is included; no installed model, credentials or live model validation is bundled. Citation validation cannot determine whether prose is factually supported: QE review is mandatory. Provider failures consume the reservation conservatively. Budgets/cache are in-memory and must become durable before multi-worker use.

`src/connectors.ts` exposes `readJiraIssue` and `readAdoWorkItem`. They return source identity, revision and raw descriptions; Jira ADF/ADO HTML is retained rather than guessed into executable tests. Supply credentials from a secret store. Native test-management plugins (Xray/Zephyr), bulk synchronization, tracker writes and result publication are future work.

See [architecture](docs/architecture.md), [delivery plan](docs/roadmap.md) and [validation status](docs/validation.md).

### Coverage design and competitive direction

[Coverage Lab](docs/coverage-lab.md) builds reproducible constrained pairwise data in Studio or with `npx tsx src/cli.ts design examples/test-design.json`. No model call is required; data-design coverage remains separate from application proof. The [competitive review and delivery plan](docs/competitive-review.md) compares documented capabilities across 17 tool families and identifies measurable next milestones.

### Environment setup

Studio → **Environments & accounts** configures application roles, accounts, web/API URLs and typed test data per environment. Functional tests can require a role and choose an environment account at execution. Password/token fields hold process secret names. See [configuration, precedence and authentication](docs/environments-and-accounts.md).

### SSO and MFA for application tests

Studio supports guided SSO/MFA sign-in and expiring account-scoped browser sessions. Configured two-stage form login also supports per-account TOTP secrets. See [setup, CI use and provider limits](docs/sso-mfa.md). SuperQ platform sign-in/RBAC remains separate.
