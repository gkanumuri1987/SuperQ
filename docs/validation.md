# Validation and remaining checks

Validated locally on macOS with Node.js 25.6.1:

- TypeScript production source builds with strict checking.
- Fourteen automated tests pass. Core, connector-contract, source-snapshot, real HTTP and Chromium tests cover reference integrity, dependency cycles, exact duplicate rejection, assertions, data precedence, blockers, unknown AI evidence, budget/cache behavior and failed-call charging.
- API and browser tests include negative outcomes; successful transport/navigation alone is insufficient.
- CLI executes the reference smoke and browser suites and writes coverage/results.
- Cucumber scenario executes the same approved API test through shared adapters.
- Dependency audit has no known vulnerabilities at validation time.

GitHub Actions and Azure Pipelines target Node.js 22 on Linux. These hosted pipelines have not been observed running yet. They install Chromium and run the build, tests, CLI/Cucumber example and audit.

Not validated: live PostgreSQL/MongoDB/Snowflake connections, database permissions/TLS/account policies, live Jira/ADO credentials and field customizations, a real application under test, a paid model provider, semantic correctness of model proposals, automatic healing or enterprise isolation. No paid model calls or database/warehouse queries were made.

External integration acceptance requires disposable fixtures and explicit permission checks. Keep the example as a reference contract, not a claim of application coverage. The database reconciliation draft intentionally remains unapproved because the reference evidence supplies no reconciliation rule.
