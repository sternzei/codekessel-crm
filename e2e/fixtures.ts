import { test as base, expect } from "@playwright/test";

// The anonymous `/t/*` budget is per client IP (60 page loads / 20 submissions
// per minute). Driving every participant flow from one address is an artifact
// of the harness, not a real deployment shape: behind a trusted proxy each
// participant arrives with their own IP. Without this the whole suite shares a
// single bucket and later magic-link submissions are silently throttled.
//
// Specs that assert throttling build their own contexts and set the header
// themselves, so they are unaffected by this fixture.
const RUN_SEED = Math.floor(Math.random() * 200) + 20;
let clientCounter = 0;

const nextClientIp = (): string => {
  clientCounter += 1;
  return `198.18.${RUN_SEED}.${clientCounter}`;
};

// The fixture callback is named `runTest` rather than Playwright's usual `use`
// so the react-hooks lint rule does not mistake it for a React hook.
export const test = base.extend({
  context: async ({ browser }, runTest) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": nextClientIp() },
    });
    await runTest(context);
    await context.close();
  },
});

export const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Points a link the app minted at the server under test. Magic links carry the
 * absolute APP_BASE_URL, so a suite run against any other port would otherwise
 * navigate away to whatever happens to answer on the configured one.
 */
export const onBaseUrl = (link: string): string => {
  const target = new URL(link);
  const base = new URL(baseUrl);
  target.protocol = base.protocol;
  target.host = base.host;
  return target.toString();
};

export { expect };
