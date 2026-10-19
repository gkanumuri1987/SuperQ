# Easy execution, browser profiles and reports

## Start with three commands

```sh
npm run superq -- init my-project.json
# Edit the environment, requirements, source evidence and test cases.
npm run superq -- doctor my-project.json
npm run superq -- plan my-project.json local regression
```

`init` creates the editable reference project and refuses to overwrite an existing file. `doctor` validates the selected profile's browser installation and credential presence without opening cloud sessions. `plan` lists selected tests, automatic prerequisites, worker count and an upper estimate of browser sessions without running anything. Neither command proves remote credentials are valid.

For the included reference app, first run `npm run reference-app` in another terminal:

```sh
npm run superq -- run examples/project.json local regression \
  --profiles local,firefox,webkit --workers 2 \
  --formats json,html,junit,markdown
```

Install the selected Playwright engines with `npx playwright install chromium firefox webkit`. Profiles run sequentially and tests within a profile run concurrently. API and database tests repeat per selected profile; choose the browser suite for a UI-only matrix to avoid repeating data-side effects.

## Browser configuration

The `browsers` object contains named profiles. The default selected name is always `local`; configuring a cloud profile never selects it automatically. Available local browser values are `chromium`, `firefox`, `webkit`, `chrome` and `edge`. Chrome/Edge use Playwright channels and require their branded browser to be installed. WebKit is an engine test, not a claim of testing the full Safari product. All profiles accept viewport, locale and timezone settings; local profiles accept `headless`.

```json
{
  "browsers": {
    "local": { "provider": "local", "browser": "chromium" },
    "firefox": { "provider": "local", "browser": "firefox" },
    "chrome": { "provider": "local", "browser": "chrome", "headless": false },
    "bs-chrome": {
      "provider": "browserstack", "browser": "chrome",
      "os": "Windows", "osVersion": "11", "browserVersion": "latest",
      "build": "Sprint 1", "project": "Checkout", "maxSessions": 2
    },
    "lt-edge": {
      "provider": "lambdatest", "browser": "edge", "platform": "Windows 11",
      "browserVersion": "latest", "build": "Sprint 1", "maxSessions": 2
    }
  }
}
```

See the full editable [cloud example](../examples/project.cloud.json). Use `BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY` or `LT_USERNAME`/`LT_ACCESS_KEY` from a secret store. Inline credentials and arbitrary provider capabilities are rejected by the schema. Cloud endpoint URLs embed credentials and must never be logged. SuperQ reports contain profile names/provider/browser, not capabilities or credential-bearing endpoints.

```sh
npm run superq -- doctor examples/project.cloud.json --profiles bs-chrome
npm run superq -- plan examples/project.cloud.json local browser --profiles bs-chrome --workers 2
# The next command opens paid sessions when valid credentials are present:
npm run superq -- run examples/project.cloud.json local browser --profiles bs-chrome --workers 2
```

Cloud sessions connect using each provider's documented Playwright WebSocket endpoint. One web journey owns one session. Credentials, capabilities and protocol mapping are contract-tested locally; real accounts have not been exercised. Provider support for your exact Playwright version, OS and browser combination must be checked with the account before rollout. This implementation does not retry a rejected cloud connection automatically.

For private applications, start the vendor's tunnel separately and set `localIdentifier` for BrowserStack or `tunnelName` for LambdaTest. SuperQ passes tunnel capabilities; it does not install or manage tunnel processes. An open cloud session cannot reach your workstation's loopback URL without a correctly configured tunnel. Do not use the reference `127.0.0.1` environment in the cloud without one.

`maxSessions` caps workers for that profile in one process. It does not discover your account quota or coordinate parallel CI jobs. Divide the account's quota across shards/jobs. Video and network logging are opt-in (`video`, `networkLogs`, default false); vendor retention and capture settings also need review. SuperQ's report is authoritative for assertion results; native provider dashboard status publication is not yet implemented.

## Parallelism, selection and retries

```sh
npm run superq -- run my-project.json qa regression --workers 4 --tags smoke,critical
npm run superq -- run my-project.json qa regression --exclude-tags destructive --max-failures 3
npm run superq -- plan my-project.json qa regression --tests TC-1,TC-2
npm run superq -- run my-project.json qa regression --shard 1/4 --workers 2
```

Include tags match any requested tag. Excluded tags remove roots, but prerequisites are still included even when excluded or outside the suite. Stable hash sharding partitions root test IDs; shared prerequisites can run in multiple shards and need isolated data. An empty selection fails explicitly rather than reporting a misleading green run. Shards produce independent reports; cross-process report merging is not implemented.

The scheduler runs only ready tests, executes shared prerequisites once per run and does not spend worker slots waiting on dependencies. A failure blocks descendants. `maxFailures` stops queued work after the threshold; already running work completes, so concurrent failures can exceed the threshold. Custom code runs in the same Node process and must be concurrency-safe. This is bounded asynchronous parallelism, not worker-process isolation.

Each journey has its own browser context and session. Tests should isolate backend data too. Runtime template keys include `${superq.testId}`, `${superq.attempt}`, `${superq.runId}`, `${superq.environment}` and `${superq.suite}`. Runtime keys override user data; use them to name disposable test entities and fixture partitions. Cleanup and seed factories remain application-specific custom handlers.

Retries default to zero, with a maximum of three. A case must also declare `retrySafe: true`; otherwise retries are suppressed to avoid repeating mutations. Retrying repeats the whole test, so the author must ensure cleanup/idempotency. All attempt statuses and the failed step/failure class are retained. A later pass is marked `flaky` and fails the default CI quality gate (`execution.failOnFlaky`). No assertion is weakened.

## Reports and coverage gates

Every run gets a unique directory under `.superq/runs/<runId>/`. The CLI prints it and updates `.superq/report.json` for compatibility. `--output` changes the root directory. Available formats:

| Format | Use |
|---|---|
| HTML | Self-contained interactive summary, tests, coverage, blockers and browser matrix views; search and status filters; responsive layout |
| JSON | Versioned structured report with attempts, matrix metadata, coverage and gate outcomes |
| JUnit XML | CI test publication, blocked/skipped cases, flaky failure policy and synthetic quality-gate failure |
| Markdown | Compact human-readable run summary and test table |

HTML is offline and uses no remote assets. Raw test data, responses, exception details and cloud capabilities are omitted. Application/test titles, blocker descriptions and IDs still appear; treat reports as private project artifacts. Files are written with owner-only permissions on systems that support them.

```sh
npm run superq -- run my-project.json qa regression \
  --minimum-automation 0.9 --minimum-proven 0.8 --critical-gaps
```

Thresholds are fractions between zero and one and default to zero. Any failed/blocked/skipped test still fails the run. `--critical-gaps` additionally fails declared critical requirement gaps. Quality gates can also be set under `reporting` in JSON. Risk-weighted coverage uses the project's declared requirements as its denominator, including requirements outside the selected suite: choose suite gates with that scope in mind. Proven coverage requires a mapped test to pass across every requested profile. It does not prove complete behavioral coverage or model factuality.

The GitHub pipeline uploads report artifacts. Azure Pipelines publishes JUnit and report artifacts. Allure, ReportPortal, historical trends, attachment capture/redaction and cross-shard aggregation are extension work rather than bundled integrations.

## References

Configuration follows [Playwright browser documentation](https://playwright.dev/docs/browsers), [BrowserStack Playwright capabilities](https://www.browserstack.com/docs/automate/playwright/playwright-capabilities), and [LambdaTest Playwright setup](https://www.lambdatest.com/support/docs/playwright-testing/). Recheck provider compatibility and tunnel instructions when configuring an account.
