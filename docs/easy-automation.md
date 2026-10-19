# Functional automation should take little attention

The default Studio landing page is **Automate**. Normal navigation shows Automate, Test library, Runs & reports, Change inbox and Connections & setup. More tools reveals the specialist screens; direct links remain valid. The product goal is time to a useful working check, not the number of tools displayed.

For an existing configured application:

1. Choose the functional expectation to verify.
2. Describe the screen interaction or API response check.
3. Create the test and try it.

Screen checks support a relative page path, optional labeled fields and named button, and explicit expected text. By default the expected text can appear anywhere on the screen. A matching element must be visible; ambiguous or absent targets fail rather than being silently chosen. Heading, status or test-ID targeting is available when needed. API checks support a relative path and a typed expected response field value, with method/body/status under Request options.

SuperQ creates draft definitions with criterion/evidence links, reuses matching catalog actions and locator definitions, and chooses an existing suite. Local trial execution uses one worker and an existing local browser profile. It never silently starts a paid cloud session or requires a model call. Trial passes remain exploratory; a named human review is still required before release evidence can be accepted.

This is a shortcut for common functional checks, not an autonomous conversion of arbitrary manual prose. The application environment and business expectations must already be configured. Longer journeys, authentication/session setup, complex data, multi-step API chains, database checks and custom code use the existing editor. Secrets should be supplied through configured secret references rather than typed into ordinary test data. Recorder-assisted capture, direct manual-case selection, and evaluated intent-to-executable generation remain future work.

Subsequent features must preserve this main path. Prefer sensible defaults and progressive disclosure; keep catalog maintenance, AI model choices, workers, capability payloads and combinatorial design out of the routine QE flow. Measure time to first passing useful check, number of required decisions, correction rate and maintenance effort in pilot sessions. No usability improvement percentage has yet been measured.
