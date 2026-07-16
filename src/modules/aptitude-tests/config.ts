const DEFAULT_TEST_URL = "https://example.com/eignungstest-platzhalter";

export function resolveAptitudeTestUrl(
  participantId: string,
  baseUrl = process.env.APTITUDE_TEST_BASE_URL,
): string {
  if (!baseUrl) return DEFAULT_TEST_URL;

  const url = new URL(baseUrl);
  url.searchParams.set("participant_id", participantId);
  return url.toString();
}

