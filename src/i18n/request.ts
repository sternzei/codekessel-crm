import { getRequestConfig } from "next-intl/server";

// German-first. Locale negotiation (internal EN fallback) comes with the
// portals in Phase 4; the message structure is ready for it.
export default getRequestConfig(async () => {
  const locale = "de";
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
