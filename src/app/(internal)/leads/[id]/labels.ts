// Canonical ordering of the participant funnel. Shared by the status dropdown
// and the undo control (to tell real status changes apart from availability_*
// pseudo-transitions that share the activity log).
export const PARTICIPANT_STATUSES = [
  "new",
  "called",
  "not_reachable",
  "wrong_number",
  "interested",
  "not_interested",
  "eligibility_unclear",
  "employer_pending",
  "qualified",
  "test_phase",
  "documents_phase",
  "application_phase",
  "enrolled",
  "lost",
] as const;

export const AVAILABILITY_LABEL: Record<string, string> = {
  yes: "Ja — 20 Std./Woche über 6 Monate möglich",
  probably_employer_pending: "Wahrscheinlich — Arbeitgeber-Freigabe offen",
  partial: "Nur teilweise möglich",
  not_possible: "Aktuell nicht möglich",
  unclear: "Noch unklar",
};

export const TEST_STATUS_LABEL: Record<string, string> = {
  invited: "Eingeladen",
  started: "Begonnen",
  completed: "Abgeschlossen",
  passed: "Bestanden",
  failed: "Nicht bestanden",
  no_show: "Nicht erschienen",
};

export function fmtDateTime(date: Date): string {
  return date.toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  });
}
