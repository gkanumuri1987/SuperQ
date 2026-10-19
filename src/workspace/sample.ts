import { validateProject, type Project } from "../model.js";
export function sampleProject(port: number): Project {
  const evidence = [
    {
      id: "SPEC-CHECKOUT",
      source: "specs/checkout.md",
      revision: "sample-v1",
      excerpt:
        "Place order returns status confirmed and total 120. Checkout button uses place-order. The screen shows Order confirmed.",
    },
    {
      id: "SPEC-ACCOUNT",
      source: "specs/account.md",
      revision: "sample-v1",
      excerpt:
        "Health returns ok. Inventory has available: true. Invalid order requests return 422. Authorization failures return 401.",
    },
  ];
  const requirements = [
    {
      id: "REQ-101",
      title: "Complete a secure checkout",
      risk: "critical",
      evidenceIds: ["SPEC-CHECKOUT"],
      criteria: [
        { id: "AC-1", title: "Order is confirmed with the correct total" },
        { id: "AC-2", title: "Customer sees the order confirmation" },
      ],
    },
    {
      id: "REQ-102",
      title: "Reject incomplete orders",
      risk: "high",
      evidenceIds: ["SPEC-ACCOUNT"],
      criteria: [
        { id: "AC-3", title: "Missing items return a validation error" },
      ],
    },
    {
      id: "REQ-103",
      title: "Protect account information",
      risk: "critical",
      evidenceIds: ["SPEC-ACCOUNT"],
      criteria: [
        { id: "AC-4", title: "Unauthenticated requests are rejected" },
      ],
    },
    {
      id: "REQ-104",
      title: "Show accurate inventory",
      risk: "medium",
      evidenceIds: ["SPEC-ACCOUNT"],
      criteria: [
        { id: "AC-5", title: "Inventory availability matches the catalog" },
      ],
    },
    {
      id: "REQ-105",
      title: "Recover from a declined payment",
      risk: "high",
      evidenceIds: ["SPEC-CHECKOUT"],
      criteria: [
        { id: "AC-6", title: "Declined payments preserve the customer basket" },
      ],
    },
  ];
  const api = (
    path: string,
    assertions: unknown[],
    input: Record<string, unknown> = {},
  ) => ({ action: "http.request", input: { path, ...input }, assertions });
  const eq = (path: string, expected: unknown) => ({
    path,
    operator: "equals",
    expected,
  });
  const tc = (
    id: string,
    title: string,
    req: string,
    criteria: string[],
    steps: unknown[],
    tags: string[],
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    title,
    origin: "qe",
    status: "approved",
    requirementIds: [req],
    covers: { [req]: criteria },
    evidenceIds: [
      req === "REQ-101" || req === "REQ-105" ? "SPEC-CHECKOUT" : "SPEC-ACCOUNT",
    ],
    suites: ["regression"],
    tags,
    steps,
    ...extra,
  });
  return validateProject({
    name: "Northstar Commerce",
    evidence,
    requirements,
    catalog: [
      {
        id: "http.request",
        kind: "api",
        operation: "request",
        description: "Send an HTTP request and validate the response",
      },
      {
        id: "browser.journey",
        kind: "web",
        operation: "journey",
        description: "Navigate, interact and verify visible behavior",
      },
    ],
    locators: {
      "checkout.submit": { strategy: "testId", value: "place-order" },
      "checkout.status": { strategy: "testId", value: "order-status" },
    },
    tests: [
      tc(
        "TC-101",
        "Place an order with valid items",
        "REQ-101",
        ["AC-1"],
        [
          api(
            "api/orders",
            [
              eq("status", 201),
              eq("body.status", "confirmed"),
              eq("body.total", 120),
            ],
            { method: "POST", body: { items: ["sample-sku"] } },
          ),
        ],
        ["api", "checkout"],
      ),
      tc(
        "TC-102",
        "Customer sees the checkout confirmation",
        "REQ-101",
        ["AC-2"],
        [
          {
            action: "browser.journey",
            input: {
              commands: [
                { type: "goto", path: "checkout" },
                { type: "click", locator: "checkout.submit" },
                {
                  type: "expectText",
                  locator: "checkout.status",
                  value: "Order confirmed",
                  timeoutMs: 2000,
                },
              ],
            },
            assertions: [eq("text.checkout.status", "Order confirmed")],
          },
        ],
        ["web", "checkout"],
      ),
      tc(
        "TC-103",
        "Reject an order without items",
        "REQ-102",
        ["AC-3"],
        [
          api("api/orders", [eq("status", 422)], {
            method: "POST",
            body: { items: [] },
          }),
        ],
        ["api", "negative"],
      ),
      tc(
        "TC-104",
        "Block unauthenticated account access",
        "REQ-103",
        ["AC-4"],
        [api("api/account", [eq("status", 401)])],
        ["api", "security"],
      ),
      tc(
        "TC-105",
        "Verify available inventory",
        "REQ-104",
        ["AC-5"],
        [api("api/inventory", [eq("status", 200), eq("body.available", true)])],
        ["api", "inventory"],
      ),
      tc(
        "TC-106",
        "Preserve the basket after payment is declined",
        "REQ-105",
        ["AC-6"],
        [],
        ["web", "payment"],
        {
          status: "draft",
          blockedBy: ["Payment sandbox and approved decline behavior required"],
        },
      ),
    ],
    browsers: {
      local: { provider: "local", browser: "chromium" },
      firefox: { provider: "local", browser: "firefox" },
      webkit: { provider: "local", browser: "webkit" },
    },
    environments: {
      sample: { baseURL: `http://127.0.0.1:${port}/sample-app/`, data: {} },
    },
    suites: { regression: { data: {} } },
    data: {},
    execution: { workers: 2 },
    reporting: { formats: ["html", "json", "junit", "markdown"] },
  });
}
export function sampleCandidate(base: Project): Project {
  const p = structuredClone(base);
  p.evidence[0]!.revision = "sample-v2";
  p.evidence[0]!.excerpt =
    "Place order now returns status placed and total 120. Checkout button uses submit-order. Screen shows Order placed. Tax must be recalculated after delivery address changes.";
  p.requirements[0]!.criteria.push({
    id: "AC-TAX",
    title: "Recalculate tax when the delivery address changes",
  });
  p.locators["checkout.submit"]!.value = "submit-order";
  p.tests[0]!.steps[0]!.assertions[1]!.expected = "placed";
  const commands = p.tests[1]!.steps[0]!.input.commands as Record<
    string,
    unknown
  >[];
  commands[2]!.value = "Order placed";
  p.tests[1]!.steps[0]!.assertions[0]!.expected = "Order placed";
  return validateProject(p);
}
export const sampleApp = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Northstar sample checkout</title><style>body{font:18px system-ui;max-width:680px;margin:80px auto;color:#15293b}button{padding:14px 20px;background:#245fec;color:white;border:0;border-radius:8px}</style><h1>Northstar sample checkout</h1><p>Sample basket · $120.00</p><button data-testid="place-order">Place order</button><p data-testid="order-status">Ready to place your order</p><script>document.querySelector('button').onclick=()=>document.querySelector('[data-testid="order-status"]').textContent='Order confirmed'</script></html>`;
