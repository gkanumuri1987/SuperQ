# Automation care and Playwright execution

Studio now has a top capability strip for **Connect & generate**, **Auto healing**, **Framework maintenance**, **Shared catalog**, **Reports** and **Feature coverage**. Quality & maintenance is also in the main navigation. The shortcuts open the corresponding workflow; specialized controls remain within that workflow.

## Catalog-based auto healing

Healing is disabled by default. Under Quality & maintenance → Auto healing, choose an original locator and either another catalog locator or an exact locator definition. Definitions are reused when they already exist. Saving an enabled policy authorizes bounded speculative local execution with the configured alternatives.

When an approved or explicitly trialed case encounters a missing control, the adapter:

1. Gives the original locator a bounded opportunity to appear (default 1 second).
2. Checks only its configured catalog alternatives. The original must still be absent, and exactly one alternative must match one visible element.
3. Uses at most one repair per test, across steps and retries. Cloud sessions do not use automatic locator alternatives.
4. Retains the original failed command and records the selected alternative by catalog ID. The project, test and expected results are not changed during execution.
5. Continues the real application flow and native Playwright assertions. Incorrect business results still fail. Existing/hidden/ambiguous original controls, ambiguous alternatives and authentication failures do not trigger a repair.

A run that finishes with passing assertions after a speculative replacement has `healed: true`. It is not a clean pass: the report has a blocking quality gate, JUnit reports a failure and proven coverage/promotion reject it. The healed marker remains effective even if the bounded diagnostic event list is truncated. Coverage and promotion also inspect recorded healing events rather than trusting only a summary flag.

Only a completed, passing speculative trial produces an **Apply repair as draft** action. Staging requires the project and loaded source/inventory context to still match the trial. It changes the recorded locator reference for that command, preserves all assertion definitions and marks the test draft with its old review removed. Old text-result keys are retained through a capture alias when necessary. Review the saved repair in the library, then run normally. That separate clean run can supply evidence under the normal coverage rules.

This is configured locator repair, not unrestricted semantic healing or learned intent discovery. A unique matching element does not prove it is the intended business control. QEs must review alternatives and validate with seeded regressions on their application. No amounts, permissions, response contracts, expected strings or business rules are weakened automatically. There is no model call, training loop, provider-authentication bypass or automatic assertion repair.

## Framework maintenance

**Run local framework checks** records:

- Whether Node meets the repository's configured minimum.
- Installed versus locked versions for Playwright, the MCP SDK and Zod; missing/unknown/drift states are explicit.
- Local Chromium/Firefox/WebKit executable presence. Installed Chrome/Edge channels and cloud compatibility remain live-validation tasks.
- Missing cloud credential names without reading their values into the report.
- Catalog actions the built-in Studio runner cannot execute; custom actions need an owned programmatic registry.

These checks do not upgrade packages, download browsers, scan vulnerabilities or start cloud sessions. A binary existing on disk does not establish compatibility or official runtime support. Project changes mark saved checks stale. Adopt framework upgrades through a reviewed dependency/lockfile change, matching browser installation, strict typechecks, framework tests and a representative application canary. Native corporate/cloud/database pilots remain necessary.

## Shared catalog and duplicate review

Quick functional authoring and intake use the same action/locator insertion helpers. Existing kind/operation handlers and exact locator definitions are reused. Project validation rejects duplicate action operations and locator definitions. The web command schema is shared by proposal validation and runtime execution.

Catalog reuse shows action/test references, exact duplicate-flow candidates and declared unreferenced definitions. Different test data, requirement scope or expectations can justify separate cases. These are review suggestions; no method, locator or case is deleted automatically, and external custom-code references are outside this static view. Semantic/AST duplicate analysis remains future work.

## Generate with no tests; enhance existing cases

Start from sources supports repository, inventory, both, or documented acceptance criteria already in the project. If no test exists, criteria become reviewable manual proposals with their original evidence. Map actions and explicit assertions, review the plan, generate drafts and run a trial. Expected behavior is not inferred from a repository URL or an empty application.

If an existing linked manual case has no executable steps, generation can enhance that exact case ID, retaining its existing data, suites, origin and requirement links. It is saved as a draft and requires review. Existing executable automation is maintained through the library/change inbox instead of being silently overwritten. New criteria for an existing feature become gap proposals. Tests and criteria already represented by executable cases are reused; exact matching does not establish semantic coverage completeness.

## Use Playwright's native behavior

The guided web recipe and adapter support:

| Purpose | Native behavior |
|---|---|
| Targeting | Exact role/name, label, text and test-ID locators; strict interaction targeting |
| Interactions | Navigate, fill, click, select an option, check and uncheck |
| Assertions | Visible text, input value, visibility, element count and application URL, using Playwright's retrying assertions |
| Evidence | Typed per-command checkpoints, step/command/attempt diagnostics and sanitized failure categories |
| Isolation | A fresh browser context for each journey; scoped restored authentication when configured |
| Execution | Named browser profiles, bounded parallel scheduling, dependency handling, explicit safe retries and CI sharding through SuperQ's runner |

No fixed sleep is used to wait for application readiness. Playwright handles actionability and assertion waiting; explicit deadlines bound execution. Repeated assertions on a changing control retain distinct checkpoints, so a later value cannot replace earlier evidence. Native count-zero assertions do not trigger missing-control healing.

SuperQ currently uses Playwright's library APIs and `expect` inside its own catalog runner. It does not expose every Playwright Test feature. Scoped/iframe/popup locators, uploads/downloads, recorder import, full fixture/project authoring, native step attachments and safely managed Trace Viewer artifacts remain additional work. Diagnostics in the reports are structured events, not a Playwright trace archive. Screenshots/network/DOM trace collection is not silently enabled because those artifacts can contain confidential page data and credentials.

These choices follow the [official Playwright guidance on resilient locators, isolation and web-first assertions](https://playwright.dev/docs/best-practices), [native assertions](https://playwright.dev/docs/test-assertions) and [Trace Viewer capabilities](https://playwright.dev/docs/trace-viewer). They do not establish complete coverage or industry superiority without application-specific evaluation.
