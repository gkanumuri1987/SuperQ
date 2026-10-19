# Recording, private traces and local agent coordination

SuperQ adds three optional helpers to the existing guided workflow. They reuse intake evidence, shared catalog generation, source revisions and QE review. None approves or certifies application behavior automatically.

## Record a flow

1. In **Start from sources**, analyze sources with **Web** selected.
2. Expand **Record a web flow**, choose a current candidate, environment account and application-relative starting path, then open the recording browser. Select anonymous recording only when intended.
3. Use the application in the local Chromium window. Use synthetic data. Supported main-page interactions include buttons, links, labeled/test-ID inputs, checkboxes and native selects.
4. In Studio, supply the expected text and its test ID, label or exact-text locator from your requirement. Add this expected result at the point it belongs in the flow; continue recording if needed.
5. Save as a draft. Open **Map actions & assertions** to inspect the sequence, fix skipped/unsupported interactions, and replace `${recorded.field1}` etc. with configured test-data variables. Data keys are flat strings, for example `"recorded.field1": "synthetic value"` in environment data, or change the mapping to `${customerName}`.
6. Resolve normal preflight blockers, review the plan, generate drafts and trial them. Materialization uses the same deduplicating locator/action helpers as other intake paths.

Recording uses a fresh isolated browser and an application-origin allowlist proxy. Account choice follows the case role and environment defaults; mismatched roles and missing secrets block recording. Configured form login and TOTP MFA use the same authentication helper as execution. SSO loads an existing account/environment-scoped session and rechecks the configured application URL and identity text before instrumentation is installed. Complete interactive SSO/MFA in **Environments & accounts** first; recording never drives an IdP or circumvents provider challenges. Missing, revoked or rejected sessions require sign-in again. Login inputs, MFA codes and sign-in commands are excluded from captured drafts. Saving preserves the resolved role/account or explicit anonymous selection in the candidate. The recorder does not send entered field values through its page binding. It skips recognized password/secret/MFA/card fields and records other fills/selections as placeholders. Application-provided labels and control names are still application data; inspect them before sharing. The page and its event binding are not a security boundary against a hostile application.

Starting query strings/fragments are rejected. Queries/fragments encountered during navigation are not separately recorded; review the resulting navigation explicitly. Frames, popups, radio groups and custom widgets require manual mapping. Unsupported-control/navigation notices remain in the candidate's review questions. There is no coordinate-based or CSS fallback and no guarantee of locator uniqueness until validated against the application. Missing/ambiguous controls fail the usual Playwright trial.

Recording is limited to ten minutes, 95 captured interactions plus explicit assertions, and 100 total commands. Closing/expiring the browser preserves the in-memory draft until saved or discarded. Restarting Studio discards unsaved capture. Finish or discard recording before other project mutations.

## Reuse browser setup

After mapping or recording a web case, expand **Reusable browser setup flows**. Choose the mapped case, give the setup an ID/title and select how many leading commands to extract. SuperQ moves that prefix into a shared project definition and replaces it with a reference in the candidate. Keep every assertion in the case. An already-identical setup is rejected in favor of reuse. Use **Add this setup to the mapped case** to append an existing setup. Existing references are retained, duplicate attachment is a no-op, and a journey can have up to four distinct setups. Under **Setup order**, move references earlier/later before plan review; every setup remains included exactly once. Inspect remaining case commands to avoid repeating setup or resetting application state.

Use **Make setup steps editable in this case** to expand all shared prefixes into ordinary case commands in their current order. The shared definitions stay in the catalog, case expectations/data variables are preserved, and plan review is cleared. The resulting flow must fit the 100-command case limit; keep shared references or split the case when it would exceed that limit. A reversed setup order can change application state; SuperQ retains the original oracle so incorrect order still fails.

A setup contains initial navigation followed by interactions, with catalog locator IDs and normal data-variable placeholders. It runs after authentication and before the case's commands, in that same isolated browser context. Each test/attempt resolves its own environment/suite/case data and account. It does not share browser sessions across parallel tests. Setup IDs are optional, so existing projects remain compatible. Maximums: 40 commands per setup, four distinct setups per journey, no nested setup references. A journey must still have its own commands and explicit assertions. Setup is repeated on each attempt; declare retry safety only when the entire flow is safe to repeat.

Use **Quality & maintenance → Catalog reuse → Shared browser setups** to edit the title, native actions, catalog controls and configured values. The editor lists directly referencing tests and downstream tests that may be blocked by those prerequisites. Saving a changed definition marks every directly referencing test as a draft and clears its review. Unchanged saves leave the project and review intact. Existing intake review is invalidated; analyze again against current sources. Review digests also bind referenced setup definitions and their locator definitions, so editing imported project JSON cannot preserve old setup approvals. Old reports lose their current project identity. Case assertions remain unchanged.

Preflight checks referenced setups and their required data variables. Structured observations and HTML diagnostics identify the setup ID separately from the case command number; each case keeps independent assertion checkpoints. Setup commands do not use speculative locator healing. Catalog usage counts setup locators and dependent tests, and agent context exposes setup metadata and variable names without literal input values. This is browser setup reuse, not an arbitrary code fixture, API data factory, cleanup/rollback guarantee or distributed worker session.

## Capture a private Playwright trace

Open **Run**, enable **Capture private Playwright traces**, and acknowledge that traces may contain secrets or personal data. Capture is off by default. It applies to browser journeys; API/database operations keep their structured diagnostics.

Native tracing starts after configured authentication checks and retains successful or failed browser journeys where the browser remains available to flush the trace. It captures screenshots, DOM snapshots and network operations. Authentication cookies, application requests and page content can still be sensitive after login. Raw traces are not redacted or encrypted. Context-level tracing does **not** record test assertions; SuperQ's structured command/assertion diagnostics remain separate. See [Playwright tracing](https://playwright.dev/docs/api/class-tracing).

**Runs & reports** offers token-authenticated download and deletion for each private ZIP. Open a downloaded file locally with:

```sh
npx playwright show-trace /absolute/path/to/superq-TRACE-ID.zip
```

Raw ZIPs live in a private `private-traces` directory beside the Studio state file (directory mode 0700, retained files 0600 on POSIX). They are excluded from HTML/JSON/JUnit/Markdown reports, the MCP context and the bundled CI report upload. Access expires after 24 hours. Cleanup runs on workspace startup, capture and every 30 seconds while Studio is running; if Studio is stopped, expired files remain on disk until next startup or manual deletion. Downloads already saved elsewhere are outside that cleanup.

Limits: 20 capture attempts per run, 50 MB per retained ZIP, and a pre-capture workspace storage check of 100 files / 450 MB. Parallel captures and Playwright's temporary recording data can exceed the pre-capture storage threshold; this is not a hard disk quota. Oversized completed ZIPs are deleted. Capture/retention failures appear as run warnings and do not change functional test outcomes. Browser crashes/timeouts may prevent a trace from being retained. Production deployments still need artifact encryption, authenticated multiuser authorization, tenant isolation, configurable retention and storage quotas.

## Ask three local agents to review coverage

After analyzing sources, expand **Three-agent coverage review · local Ollama**, enter an explicitly installed local model name and start review. SuperQ does not install models, select one silently or fall back to a paid service.

The deterministic coordinator invokes three separate scoped model calls:

- **Analyst** identifies source-backed gaps and open questions.
- **Designer** proposes up to ten cases, citing exact loaded source/revision/excerpt, optionally with executable mappings.
- **Reviewer** independently challenges the design and identifies proposals suitable for human review and unresolved concerns.

The same model serves the three roles, sequentially. There is no recursive delegation, tool/shell access or automatic repair loop. Bounds are three calls, 4,000 output tokens per call, a 128 KB prompt limit, bounded structured output, per-request timeout and a three-minute overall deadline. Cancel aborts the request and discards unapplied results. Local inference consumes your machine's resources but makes no paid model calls. Ollama requests use loopback `/api/generate` with role-specific JSON schemas. Before sending source context, SuperQ requires `/api/status` to confirm cloud disabled, checks installed model metadata through `/api/tags` and `/api/show`, and rejects remote or unknown models. Configure the trusted daemon with `OLLAMA_NO_CLOUD=1` and restart it; older daemons without a supported status response fail closed. Successful role calls record the resolved model name/digest; a digest change during inference discards the response. Remote endpoints and model names containing `cloud` are also rejected.

The job exposes role progress, model name, proposals, questions, reviewer concerns and source identities in Studio. Accepted proposals can be **staged for QE review** only when there are no reviewer concerns and the project, loaded sources and exact plan still match the frozen input. Staging is atomic and revalidates all citations and duplicate titles. It never approves the plan, generates runnable tests, executes the app or changes the source repository. Existing plan review is invalidated. Agent agreement and exact citations prove neither business correctness nor complete coverage.

This coordinator complements the existing corporate-agent MCP integration. It does not use a corporate Copilot license or grant the MCP host access to raw traces. The local worker interface supports injected providers for integration tests; enterprise model/provider orchestration, separate role models and distributed workers are future integrations.

## Verification and limits

Automated local Chromium checks cover real trusted recording events, entered-value exclusion, password skipping, explicit assertions, placeholder/catalog replay, form/TOTP sign-in, scoped SSO restoration/rejection, account selection, shared setup extraction/editing, additive attachment, ordered composition, editable copies with unchanged oracles, dependency impact, no-op review preservation, isolated per-case data and review invalidation, application-origin blocking, native failed-journey ZIPs, default-off capture, private permissions, expiry/deletion and authenticated download. Studio checks exercise recorder controls, review/generation, trace download, agent staging, desktop/mobile layout and browser errors. Coordinator tests cover bounded role order, unsupported citations, cancellation and stale staging using controlled worker responses. Ollama transport tests validate structured requests against a mock transport. A live local model, headed user recording on every OS, real enterprise IdP tenants, corporate MCP hosts, cloud sessions and real customer applications remain unvalidated.
