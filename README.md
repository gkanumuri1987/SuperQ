# SuperQ

Evidence-driven automation for quality engineering teams. SuperQ keeps application source read-only and owns its test catalog, assertions, data and execution in a separate repository.

**Status: runnable foundation, not a finished enterprise platform.** Web and API execution are demonstrated locally. PostgreSQL, MongoDB and Snowflake adapters and Jira/ADO read connectors need integration validation with your systems. AI and healing are reviewable proposal interfaces; no autonomous learning, model subscription or paid calls are enabled.

## Run locally

Requires Node.js 22+ and Git.

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

Execution writes `.superq/report.json`. Any failed, blocked or skipped selected test produces a nonzero exit status. `analyze` is informational and reports gaps without running tests. Tests without explicit assertions cannot pass. Each browser journey has an isolated browser context; API calls are stateless. Share business setup through fixtures and test data rather than dependent mutable sessions.

## What is implemented

| Area | Foundation behavior |
|---|---|
| Traceability | Evidence → requirements → QE/AI tests → shared actions → results |
| Coverage | Missing QE review, approval, asserted automation and blockers; risk-weighted mapped vs passed coverage |
| Reuse | Unique action IDs, operation handlers and locator definitions; identical step sequences flagged as duplicate candidates |
| Execution | Playwright web/API, SELECT adapters for PostgreSQL/Snowflake, bounded MongoDB find, custom TypeScript handlers |
| Data | Global → environment → suite → test overrides; `${key}` interpolation preserves exact-value types |
| Dependencies | Cycles rejected; prerequisite failures block descendants; explicit blockers recorded |
| Knowledge | Explicit tracked-file snapshots at committed revisions, hashes and change reports; no source writes |
| AI controls | Provider interface, evidence reference validation, bounded reservations, in-process cache, no retry loops |
| Healing | Candidate eligibility proposal only; human review always required |
| BDD | Runnable Cucumber scenario reuses the same catalog and execution engine |
| Trackers | Programmatic read-only Jira Cloud issue and Azure DevOps work-item connectors |
| CI | GitHub Actions and Azure Pipelines examples |

## Configure your application

Copy `examples/project.json`. Replace reference evidence with your real acceptance criteria and source revisions. Add requirements and test cases, then reuse catalog action IDs and centralized locators. Keep AI suggestions as `draft` until QE review; evidence references prove provenance, not truth. The reference data reconciliation case deliberately lacks a specification and remains blocked.

Action operation signatures:

- `api:request`: `{path, method?, body?, headers?}` → `{status, body}`. Same-origin only, redirects disabled.
- `web:journey`: `{commands: [{type: 'goto', path}, {type: 'fill', locator, value}, {type: 'click', locator}, {type: 'text', locator}]}` → `{url, text}`. Text values use locator IDs as keys. Third-party browser requests are blocked in this version; federated login requires an explicit future origin policy.
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

Pass all paths in scope for each snapshot; omission is interpreted as removal. Files must be tracked, committed, small text files within the repository. The explicit path list and filename guards reduce accidental exposure but do not detect every secret. Review source before sharing evidence with a model. Snapshot output contains code; store it privately. Source updates are manual commands or CI steps today, not a background watcher.

### AI and tracker extension points

`src/ai.ts` accepts a `ModelProvider`. Use your organization's model gateway to enforce a hard per-call budget and return actual cost. Call `Planner.propose` with a project, requirement ID and maximum reserved cost. No provider, credentials or live model calls are bundled. Citation validation cannot determine whether prose is factually supported: QE review is mandatory. Provider failures consume the reservation conservatively. Budgets/cache are in-memory and must become durable before multi-worker use.

`src/connectors.ts` exposes `readJiraIssue` and `readAdoWorkItem`. They return source identity, revision and raw descriptions; Jira ADF/ADO HTML is retained rather than guessed into executable tests. Supply credentials from a secret store. Native test-management plugins (Xray/Zephyr), bulk synchronization, tracker writes and result publication are future work.

See [architecture](docs/architecture.md), [delivery plan](docs/roadmap.md) and [validation status](docs/validation.md).
