// The aptitude test lives with an external provider; APTITUDE_TEST_BASE_URL is
// where participants are sent. Unset, the app used to hand out an example.com
// placeholder — a dead end a real participant would receive by WhatsApp. So the
// invite is gated on this being configured (see isAptitudeTestConfigured) and
// the placeholder now only ever appears in dev/demo data.
const DEFAULT_TEST_URL = "https://example.com/eignungstest-platzhalter";

/** Whether a real test provider is configured; the invite is blocked if not. */
export function isAptitudeTestConfigured(
  baseUrl = process.env.APTITUDE_TEST_BASE_URL,
): boolean {
  return Boolean(baseUrl && baseUrl.trim().length > 0);
}

export function resolveAptitudeTestUrl(
  participantId: string,
  baseUrl = process.env.APTITUDE_TEST_BASE_URL,
): string {
  if (!baseUrl) return DEFAULT_TEST_URL;

  const url = new URL(baseUrl);
  url.searchParams.set("participant_id", participantId);
  return url.toString();
}
