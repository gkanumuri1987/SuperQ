# Validation and remaining checks

Validated locally on macOS with Node.js 25.6.1:

- TypeScript production source builds with strict checking.
- Forty-nine automated tests cover the full Chromium, Firefox and WebKit configuration. Core, connector-contract, source-snapshot, real HTTP and Chromium tests cover reference integrity, dependency cycles, exact duplicate rejection, assertions, data precedence, blockers, unknown AI evidence, budget/cache behavior and failed-call charging.
- API and Chromium/Firefox/WebKit browser tests include negative outcomes; successful transport/navigation alone is insufficient.
- Parallel worker bounds, shared dependencies, max-failure stopping, safe retries, tag selection, stable sharding, credential-free cloud planning and cloud capability mapping are tested.
- Offline HTML report view switching, filtering and mobile layout are browser-tested; the desktop report was visually inspected. XML/HTML escaping and quality gates are tested.
- CLI executes smoke and a six-execution regression matrix across local Chromium/Firefox/WebKit profiles; init, doctor and plan are exercised. It writes HTML/JSON/JUnit/Markdown reports.
- Cucumber scenario executes the same approved API test through shared adapters.
- Dependency audit has no known vulnerabilities at validation time.

GitHub Actions and Azure Pipelines target Node.js 22 on Linux. These hosted pipelines have not been observed running yet. They install Chromium, Firefox and WebKit and run the build, tests, CLI/Cucumber example and audit.

Not validated: live PostgreSQL/MongoDB/Snowflake connections, database permissions/TLS/account policies, live BrowserStack/LambdaTest sessions, tunnel reachability, native cloud status publication, account quotas, installed Chrome/Edge channels, live Jira/ADO credentials and field customizations, a real application under test, a paid model provider, semantic correctness of model proposals, automatic healing or enterprise isolation. No paid model calls or database/warehouse queries were made.

External integration acceptance requires disposable fixtures and explicit permission checks. Keep the example as a reference contract, not a claim of application coverage. The database reconciliation draft intentionally remains unapproved because the reference evidence supplies no reconciliation rule.


Whole-tool review validation additionally covers explicit acceptance-criterion gaps, review digest drift, duplicate/missing release results, stale evidence, artifact/environment mismatches, independent approvals, edited summary rejection, response capture, nested fixture isolation, cancellation/deadlines, invalid local AI references, billing violations and knowledge hash tampering. Production source, tests and TypeScript examples are typechecked.

Ollama is validated with an injected fake transport, not live model inference. Promotion tests use controlled fixtures and deliberately invalid manifests; they do not establish production readiness for a real application. The release command issues no certification and performs no deployment. See the review guide for remaining signed-provenance, authenticated-approval and isolation requirements.
