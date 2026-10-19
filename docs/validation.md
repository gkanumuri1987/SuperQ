# Validation and remaining checks

Validated locally on macOS with Node.js 25.6.1:

- TypeScript production source builds with strict checking.
- Fifty-seven automated tests cover the full Chromium, Firefox and WebKit configuration. Core, connector-contract, source-snapshot, real HTTP and Chromium tests cover reference integrity, dependency cycles, exact duplicate rejection, assertions, data precedence, blockers, unknown AI evidence, budget/cache behavior and failed-call charging.
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


Studio validation adds the local API mutation token/revision checks, exact source-file impact/deletion detection, source repository write isolation, safe maintenance staging, preservation of later review attestations, stale proposal rejection, draft validation without approval, stale-run proof rejection, visual test creation/editing, human review, focused real API execution and responsive mobile navigation. Desktop overview, change review, builder and mobile screens were visually inspected.

The Studio starts with a labeled sample and no live remote connections. Tracker synchronization and full visual-regression analysis are not represented as implemented. Local source monitoring operates only while the server runs.

## Environment-scoped accounts and data

The full local suite passes 74 tests. New coverage exercises role selection/ambiguity, missing secrets, anonymous behavior, environment separation, typed suite/case overrides, distinct API URLs, bearer injection and explicit header override, cross-service credential boundaries, browser form login with a real local session, locator data substitution, run-identity invalidation, and the rendered Studio setup/selection workflow. Production build and strict typechecks pass; desktop/mobile layouts were visually inspected. These checks use controlled local fixtures, not live QA/UAT systems, SSO/MFA or a production authorization audit.

## Application SSO/MFA

The full local suite passes 79 tests, including redirected interactive MFA capture/reuse, environment/account isolation, expiry and provider rejection blockers, cancellation, disallowed redirect prevention, HTTPS tunnel destination controls, RFC 6238 vectors for SHA-1/SHA-256/SHA-512, actual TOTP form submission, and Studio save/forget/TOTP configuration. Production build and strict typechecks pass. Tests use local fixtures and headless Chromium capture connectors; native headed interaction, live identity-provider policies, hardware factors and remote-browser compatibility remain unvalidated. No paid cloud browser or model call was used.


## Guided intake and coding-agent interoperability

The full local suite passes 92 tests, with a production build, strict backend/frontend/test typechecks and clean diff checks. Repository-only, inventory-only and combined intake are covered, including an actual temporary Git checkout that remains unchanged by SuperQ. Tests exercise source revisions, exact citations, scope/lifecycle, dependency cycles, missing data/accounts/SSO sessions, duplicate mappings, plan-review invalidation, draft generation and API trials that cannot silently inherit unrelated tag/shard filters.

The active Studio test pastes manual cases, maps an ordered flow through visual controls, reviews the plan, generates drafts, clicks the local sample application and verifies its result at desktop/mobile widths. A real official-SDK MCP client launches the stdio server as a child process and tests tool discovery, proposal/review separation, credential scope, stale requests, optional reviewed-trial permission, revocation, account selection and sanitized diagnostics. Multiple assertions against the same changing UI control retain distinct checkpoints. Source tools reject unknown paths/stale revisions and fetch only explicitly scanned content. Desktop intake rendering was visually inspected.

These are controlled local fixtures, not a live corporate Copilot deployment, native tracker-suite synchronization, arbitrary-code semantic evaluation, autonomous browser exploration or a production certification exercise. The MCP interface does not sandbox a host with other local permissions. No paid AI/cloud sessions were used. Hosted CI for this revision remains unobserved.

## Automation care, generation without tests and native Playwright steps

The full local suite passes 100 tests. Production build, strict backend/frontend/test typechecks and diff checks pass. New tests exercise bounded configured healing against a real local browser, unchanged assertions, original failure retention, refusal of incorrect results and ambiguous alternatives, clean reruns after draft staging, legacy text capture aliases, diagnostic truncation, rejection of healed promotion evidence and framework lock-version drift. Structured diagnostics are not native Playwright trace archives.

Generation tests cover documented criteria without repositories/inventories/tests and enhancement of existing empty manual cases. An end-to-end workspace test verifies that the existing manual ID/data/requirement/catalog are preserved through review, draft generation and actual API execution. Imported manual-case revisions are retained alongside the business criterion evidence when an existing case is enhanced. A native browser form exercises dropdown/checkbox interactions and value/visibility/count/URL assertions with typed checkpoints. The active Studio test checks capability navigation, healing setup, actual execution, draft repair staging, package/browser diagnostics and desktop/mobile layout. The desktop care screen was visually inspected.

New browser paths were validated with local Chromium fixtures. Live application false-heal rates, corporate/cloud/browser-channel compatibility and every Playwright Test feature remain unvalidated. Healing uses configured catalog alternatives, not learned semantic intent. Framework checks make no upgrades/downloads or paid calls. Native recorder import, safely managed screenshots/network/DOM traces and a multi-agent coordinator remain future work.
