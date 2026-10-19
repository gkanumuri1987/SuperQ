import type { BrowserContext } from "@playwright/test";
/** Enforce before sending HTTP redirects or connecting WebSockets, including subframes/popups. */
export async function restrictBrowserOrigin(
  context: BrowserContext,
  baseURL: string,
  networkGuard?: { assertAllowed(): void },
) {
  const origin = new URL(baseURL).origin;
  if (!networkGuard && context.browser()?.browserType().name() === "chromium") {
    // Fulfilled HTTP responses lose Chromium's private-address classification.
    // Scope this permission to the configured app; routing still denies other origins.
    await context.grantPermissions(["local-network-access"], { origin });
  }
  let denied = false;
  const allowed = (value: string, socket = false) => {
    try {
      const url = new URL(value);
      if (socket)
        url.protocol =
          url.protocol === "wss:"
            ? "https:"
            : url.protocol === "ws:"
              ? "http:"
              : url.protocol;
      return !url.username && !url.password && url.origin === origin;
    } catch {
      return false;
    }
  };
  // The proxy checks each hop. Without it, fulfilled redirects can bypass later
  // routing on some engines: reject all redirects, including same-origin ones.
  await context.route("**/*", async (route) => {
    if (!allowed(route.request().url())) {
      denied = true;
      await route.abort();
      return;
    }
    if (networkGuard) {
      await route.continue();
      return;
    }
    let response: Awaited<ReturnType<typeof route.fetch>> | undefined;
    try {
      response = await route.fetch({
        maxRedirects: 0,
        maxRetries: 0,
        timeout: 15000,
      });
      const location = response.headers().location;
      if (response.status() >= 300 && response.status() < 400 && location) {
        denied = true;
        await route.abort();
        return;
      }
      await route.fulfill({ response });
    } catch {
      denied = true;
      await route.abort().catch(() => {});
    } finally {
      await response?.dispose().catch(() => {});
    }
  });
  await context.routeWebSocket("**/*", (socket) => {
    if (allowed(socket.url(), true)) socket.connectToServer();
    else {
      denied = true;
      socket.close({ code: 1008, reason: "Application origin policy" });
    }
  });
  return {
    assertAllowed() {
      networkGuard?.assertAllowed();
      if (denied)
        throw new Error("Browser traffic failed the application origin policy");
    },
  };
}
