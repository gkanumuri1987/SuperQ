import { chromium, type Browser } from "@playwright/test";
import { z } from "zod";
import {
  LocatorDefinition,
  RelativePath,
  webCommandSchema,
} from "./web-commands.js";
import { Recipe } from "./intake.js";
import { openAuthProxy } from "./auth-proxy.js";

const Event = z
  .object({
    type: z.enum(["click", "fill", "selectOption", "check", "uncheck"]),
    locator: LocatorDefinition,
  })
  .strict();
export type Recording = {
  commands: Extract<Recipe, { kind: "web" }>["commands"];
  notices: string[];
  closed: boolean;
};
/** A fresh, anonymous local browser. Input values never cross the page binding. */
export async function startRecording(
  baseURL: string,
  path: string,
  connector = (proxy: { server: string; bypass: string }) =>
    chromium.launch({ headless: false, proxy }),
) {
  RelativePath.parse(path);
  const startURL = new URL(path, baseURL);
  if (startURL.search || startURL.hash)
    throw new Error(
      "Use a starting path without query strings or fragments; map them explicitly after recording",
    );
  const origin = new URL(baseURL).origin;
  const network = await openAuthProxy(new Set([origin]));
  let browser: Browser;
  try {
    browser = await connector(network.proxy);
  } catch {
    await network.close();
    throw new Error("Install local Chromium before recording");
  }
  const recording: Recording = {
    commands: [{ type: "goto", path }],
    notices: [],
    closed: false,
  };
  const notice = (s: string) => {
    if (!recording.notices.includes(s) && recording.notices.length < 20)
      recording.notices.push(s);
  };
  const close = async () => {
    if (recording.closed) return;
    recording.closed = true;
    clearTimeout(timer);
    await browser.close().catch(() => {});
    await network.close();
  };
  const timer = setTimeout(() => void close(), 600000);
  timer.unref();
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await context.exposeBinding(
      "__superqRecord",
      async ({ page, frame }, raw: unknown) => {
        if (
          recording.closed ||
          frame !== page.mainFrame() ||
          new URL(frame.url()).origin !== origin
        )
          return;
        if (recording.commands.length >= 95) {
          notice(
            "Recording limit reached. Split this flow into smaller tests.",
          );
          return;
        }
        if (raw === "unsupported") {
          notice(
            "A sensitive or unsupported control was skipped. Review missing steps before mapping.",
          );
          return;
        }
        const result = Event.safeParse(raw);
        if (!result.success) return;
        const e = result.data;
        if (e.locator.value.length > 200 || (e.locator.name?.length ?? 0) > 200)
          return;
        const c =
          e.type === "fill" || e.type === "selectOption"
            ? {
                ...e,
                value: `\${recorded.field${recording.commands.filter((c) => "value" in c).length + 1}}`,
              }
            : e;
        // Changes are emitted on blur/change, keeping typing out of the event stream.
        recording.commands.push(webCommandSchema(LocatorDefinition).parse(c));
      },
    );
    await context.addInitScript({
      content: `(()=>{
      if(window.top!==window)return;
      const send=(value)=>{void window.__superqRecord(value).catch(()=>{});};
      const locate=(el)=>{
        const testId=el.getAttribute('data-testid');if(testId)return {strategy:'testId',value:testId};
        const input=el;
        const label=el.getAttribute('aria-label')||input.labels?.[0]?.textContent?.trim();if(label)return {strategy:'label',value:label};
        const role=el.getAttribute('role')||(el.tagName==='BUTTON'?'button':el.tagName==='A'?'link':undefined);
        const name=el.textContent?.trim();if(role&&name)return {strategy:'role',value:role,name};
        return undefined;
      };
      const sensitive=(el)=>/password|hidden|file/i.test(el.getAttribute('type')??'')||/password|one-time|cc-|email|tel/i.test(el.getAttribute('autocomplete')??'')||/password|secret|token|otp|mfa|credit|card|ssn/i.test([el.id,el.getAttribute('name'),el.getAttribute('aria-label'),(el).labels?.[0]?.textContent].join(' '));
      document.addEventListener('click',event=>{
        if(!event.isTrusted)return;
        const el=event.target?.closest('button,a,[role="button"]');if(!el)return;
        const locator=locate(el);if(!locator||sensitive(el)){send('unsupported');return;}send({type:'click',locator});
      },true);
      document.addEventListener('change',event=>{
        if(!event.isTrusted)return;
        const el=event.target; if(!['INPUT','TEXTAREA','SELECT'].includes(el.tagName))return;
        const locator=locate(el);if(!locator||sensitive(el)){send('unsupported');return;}
        const type=el.type==='checkbox'?(el.checked?'check':'uncheck'):el.tagName==='SELECT'?'selectOption':'fill';
        if(el.type==='radio'){send('unsupported');return;}send({type,locator});
      },true);
    })();`,
    });
    const page = await context.newPage();
    context.on("page", (popup) => {
      if (popup !== page) {
        notice("Popups are unsupported; map this flow manually.");
        void popup.close();
      }
    });
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) {
        notice(
          "Frames are unsupported; review and map any frame interactions manually.",
        );
        return;
      }
      if (frame === page.mainFrame() && frame.url() !== "about:blank") {
        const url = new URL(frame.url());
        if (url.search || url.hash)
          notice(
            "Navigation query or fragment requires manual review; it is not saved by the recorder.",
          );
      }
    });
    browser.on("disconnected", () => {
      void close();
    });
    await page.goto(new URL(path, baseURL).href);
    return {
      snapshot: () => structuredClone(recording),
      close,
      assert: (raw: unknown) => {
        if (recording.closed) throw new Error("Recording closed");
        const c = webCommandSchema(LocatorDefinition).parse(raw);
        if (!c.type.startsWith("expect"))
          throw new Error("Add an explicit expected result");
        if (recording.commands.length >= 100)
          throw new Error("Recording limit reached");
        recording.commands.push(webCommandSchema(LocatorDefinition).parse(c));
      },
      finish: () => Recipe.parse({ kind: "web", commands: recording.commands }),
    };
  } catch {
    await close();
    throw new Error(
      "Recording could not start; check the application URL and local browser",
    );
  }
}
