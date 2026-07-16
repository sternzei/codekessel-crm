import { env } from "@/lib/env";
import { MockRegisterProvider } from "./mock";
import { OpenRegisterProvider } from "./openregister";
import type { RegisterProvider } from "./types";

export * from "./types";

/**
 * Resolves the register data source. With OPENREGISTER_API_KEY set it talks to
 * the live OpenRegister API; otherwise it returns the demo-safe mock so the
 * admin import flow stays fully functional without a key (and without spending
 * credits). Mirrors the WhatsApp/email adapter's live-vs-mock pattern.
 */
export function getRegisterProvider(): RegisterProvider {
  if (env.OPENREGISTER_API_KEY) {
    return new OpenRegisterProvider(
      env.OPENREGISTER_API_KEY,
      env.OPENREGISTER_BASE_URL,
    );
  }
  return new MockRegisterProvider();
}
