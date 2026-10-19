# AI automation landscape and SuperQ delivery plan

Reviewed 2026-10-19. This is a representative primary-source review of 17 products/tool families, not an exhaustive market census or a hands-on performance benchmark. Availability, editions and vendor claims can change. No vendor account, paid trial, cloud execution or live model evaluation was used. Vendor improvement percentages and rankings were deliberately not adopted as evidence of comparative quality.

## What the market already offers

| Product / family | Documented capability signal | Lesson for SuperQ | Primary source |
|---|---|---|---|
| BrowserStack AI | Test creation, maintenance, data, deduplication and failure-analysis workflows; agentic low-code workflow marked Alpha | Make lifecycle handoffs and availability explicit | [Agent docs](https://www.browserstack.com/docs/test-management/browserstack-ai), [agentic authoring](https://www.browserstack.com/docs/low-code-automation/test-recording/browserstack-ai/agentic-testing) |
| TestMu AI / LambdaTest KaneAI | Natural-language authoring and execution integrated with test management | Integrate intent, execution and review rather than disconnected prompts | [KaneAI FAQs](https://www.testmuai.com/support/docs/kaneai-faqs/) |
| mabl | Adaptive locator/step healing and requests for human context | Gather execution evidence before suggesting repairs | [Adaptive healing](https://www.mabl.com/auto-healing-tests) |
| Tricentis Testim | AI-assisted testing, including a Salesforce-specific agent | Model domain-specific capabilities instead of claiming universal support | [AI overview](https://docs.tricentis.com/testim/content/overview/testim-overview/use-ai-in-with-testim/index.htm) |
| Functionize | Learned element identification and visible healing changes | Show exactly what changed and retain the original failure | [Dynamic learning](https://www.functionize.com/self-healing) |
| Katalon | Project-aware assistant, agent mode, provider choices and management workflows | Keep code extension and cross-artifact context available | [Studio assistant](https://docs.katalon.com/katalon-studio/studioassist/studioassist-overview), [platform assistant](https://docs.katalon.com/katalon-platform/katalon-ai-assistant) |
| Autify Nexus | Specification-based cases, natural-language recording and locator repair | Support manual QE workflows with editable artifacts | [Generation guide](https://helpcenter.autify.com/docs/test-case-generation), [product](https://autify.com/products/autify-nexus) |
| Momentic | Natural-language tests, CLI/CI and codebase-context maintenance claims | Keep tests versionable and executable outside the UI | [Product](https://momentic.ai/), [official examples](https://github.com/momentic-ai/examples) |
| QA Wolf | AI-assisted automation service/platform; structured checks for generative outputs | Evaluate actual defect detection and ownership, not agent counts | [AI testing](https://www.qawolf.com/education/ai-software-testing), [GenAI validation](https://www.qawolf.com/solutions/gen-ai-testing) |
| testRigor | Plain-language UI testing | Minimize authoring friction while preserving explicit expected results | [Product](https://testrigor.com/) |
| Applitools | Visual comparison and no-code autonomous authoring | Add visual baselines as an independent oracle with approval history | [Visual options](https://applitools.com/docs/autonomous/authoring-a-test/custom-flow-test/visual-ai-options), [Autonomous](https://support.applitools.com/platform/autonomous/) |
| Playwright Test Agents | Planner, generator and healer with live selector/assertion verification | Prefer native framework artifacts; never conceal lost coverage by skipping failures | [Test agents](https://playwright.dev/docs/test-agents) |
| Stagehand | Natural-language browser actions within code | Separate exploratory agent actions from reviewed deterministic regression tests | [Official site](https://stagehand.dev/) |
| Schemathesis | Schema-derived property tests and stateful API workflows | Use deterministic schema/property generation for API depth | [Docs](https://schemathesis.readthedocs.io/en/stable/), [stateful testing](https://schemathesis.readthedocs.io/en/stable/explanations/stateful/) |
| Cypress | Natural-language `cy.prompt` with generated code export and visible healing | Retain a path from assisted authoring to committed regression code | [Generation guide](https://docs.cypress.io/app/guides/ai-test-generation) |
| Postman Postbot | API request troubleshooting and test script assistance | Treat API contract and business-oracle depth as first-class requirements | [Postbot docs](https://learning.postman.com/v11/docs/getting-started/basics/about-postbot) |
| Reflect | AI-assisted creation offered in its registration flow | Evaluate usability in a future trial; insufficient reviewed documentation for stronger claims | [Official registration](https://app.reflect.run/registration?selectedPlan=1) |

These capabilities do not establish that a product correctly understands every business rule. Pricing, false-heal rates, privacy guarantees and superiority were not independently established in this review. Mobile coverage or database correctness cannot be inferred from a web demo.

## SuperQ position after repository review

SuperQ is a runnable local foundation. It has real API/browser execution, database adapters, shared actions/locators, draft/review controls, artifact-bound release assessment, parallel scheduling, report views, constrained local Ollama drafts, source-change review and manual/sprint intake. These are implemented paths, not proof of enterprise readiness. Source watching covers explicitly mapped committed files, not semantic understanding of the whole application. Planning exports are mapped JSON; direct tracker suite synchronization is incomplete.

The largest gaps are reliable conversion from manual intent into executable assertions, authenticated incremental knowledge ingestion, grounded document conflict analysis, execution artifacts for diagnosis/healing, reusable fixture/data lifecycles, broad assertions, and durable team/CI operations. SuperQ does not currently outperform the reviewed products in measured trials.

## Product direction

Make the complete quality argument inspectable: source evidence → business rule → test-design obligation → manual case → reviewed executable assertion → exact-build result → release decision. An unknown link must remain visible. AI drafts and repairs must preserve this chain. A polished conversation alone is insufficient.

Use deterministic tools for schema validation, data combinations, graph traversal, duplicate hashes and execution. Use local or explicitly selected remote models for language interpretation and ambiguous gap suggestions. Cache by source revision, model/prompt version and policy. Never pay for repeated inference during deterministic regression runs. Track compute and reviewer effort as well as provider invoices.

## Delivery sequence and measurable exits

| Order | Deliverable | Observable acceptance |
|---|---|---|
| 1 | Coverage Lab (implemented in this change) | Independently tested coverage of all feasible value/pair obligations; constraints visible; bounded computation; export contains provenance; no inflation of application proof |
| 2 | Intake-to-automation bridge | QE selects a case; existing actions/locators retrieved; missing oracles become questions; generated definition validates and runs against a controlled app; review retained in version history |
| 3 | AI regression evaluation | Versioned supported/ambiguous/contradictory/injection fixtures; reference precision, abstention, assertion preservation, reviewer acceptance and cost measured; regressions block model/prompt promotion |
| 4 | Native tracker and source ingestion | ADO/Jira field mapping and test-plugin adapters; pagination, deletion, permission and revision conflicts tested; application credentials demonstrably read-only; no credential leakage |
| 5 | Evidence retrieval and gap analysis | Versioned source/story/design/defect lineage; contradiction queue; unknown inventory recorded; every proposed rule cites exact evidence; reviewers reject unsupported extrapolations |
| 6 | Failure diagnosis and controlled healing | Sanitized trace/DOM/network snapshots; original failure retained; proposed diff leaves business assertions intact; replay passes against fixed app and fails against seeded regression; ambiguous repairs abstain |
| 7 | Deeper verification | OpenAPI/schema/property/stateful tests, accessibility, reviewed visual baselines, database reconciliation with decimal/time/null/eventual-consistency rules; seeded defects demonstrate each oracle |
| 8 | Test data and reusable modules | Namespaced fixtures, secret references, suite/case/env overlays, cleanup and independent reruns; reuse suggestions never merge distinct business expectations |
| 9 | Enterprise execution | Authenticated roles/approvals, isolated workers, cancellation, distributed quotas, complete shard aggregation and signed CI provenance; concurrency, recovery and authorization tests pass |
| 10 | Mobile and performance | Appium/device adapters and workload-based performance execution with actual domain metrics; preserve shared lineage without pretending functional pass rate proves performance |

Do not advertise an unmeasured zero-hallucination rate, complete feature knowledge, autonomous production certification or industry leadership. Earn the claim through a reproducible pilot: use the same application versions, known seeded defects, environments, datasets and allowed setup time for each evaluated tool. Record first useful test time, meaningful assertion density, defect recall, false-positive rate, false-heal rate, maintenance minutes per change, deterministic runtime, total cost per accepted test and source-to-test traceability. Report raw results, review effort, exclusions and unknowns. No cross-vendor benchmark has yet been run.
