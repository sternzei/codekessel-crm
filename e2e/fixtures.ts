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

export { expect };
