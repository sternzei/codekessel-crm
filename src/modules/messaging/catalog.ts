// The authoritative list of outbound message templates.
//
// `message_templates` rows are the runtime source (a tenant may edit its own
// copy), but this catalog defines which (key, channel) combinations MUST exist:
// rendering refuses to improvise, so a key without a row means no message is
// sent at all. `tests/unit/message-catalog.test.ts` asserts the catalog covers
// every key the code can ask for, and the seed writes it out.

/**
 * Variables every send path guarantees. Templates may only reference these —
 * `renderTemplate` throws on an unresolved placeholder rather than shipping a
 * silent gap, so anything else would break the send at runtime.
 *
 * `link` is only guaranteed for task types that have a magic-link landing page
 * (see TASK_TYPES_WITH_LANDING_PAGE), so only those templates may use it.
 */
export const GUARANTEED_VARIABLES = ["firstName", "title", "link"] as const;

export const MESSAGE_CHANNELS = ["whatsapp", "email"] as const;

export type MessageTemplateChannel = (typeof MESSAGE_CHANNELS)[number];

/**
 * External task types that render a real page under `/t/[token]`. A magic link
 * for anything else would drop the recipient on the generic "please contact
 * us" card, so those templates carry no {{link}}.
 * Kept in sync with the scope switch in `src/app/t/[token]/page.tsx`.
 */
export const TASK_TYPES_WITH_LANDING_PAGE = [
  "confirm_availability",
  "start_aptitude_test",
  "request_correct_contact",
  "confirm_reachability",
  "reschedule_after_no_show",
  "give_consent",
  "upload_documents",
  "sign_document",
  "confirm_submission",
  "provide_betriebsnummer",
  "confirm_ags_status",
  "confirm_time_model",
  "employer_setup",
] as const;

/** Every task type that can be handed to a participant or an employer. */
export const EXTERNAL_TASK_TYPES = [
  ...TASK_TYPES_WITH_LANDING_PAGE,
  "appointment_reminder",
] as const;

/** Reminder-plan template keys referenced by the seeded routing rules. */
export const REMINDER_TEMPLATE_KEYS = [
  "appointment_reminder_24h",
  "appointment_reminder_2h",
  "test_reminder_24h",
  "test_reminder_48h",
  "signature_reminder_24h",
  "signature_reminder_72h",
] as const;

/** Fallback key for a reminder job whose plan step named no template. */
export const GENERIC_REMINDER_TEMPLATE_KEY = "reminder_generic";

export type TemplateDefinition = {
  readonly key: string;
  /** Subject line for the email channel; WhatsApp ignores it. */
  readonly subject: string;
  readonly body: string;
};

const EMAIL_SIGN_OFF = "\n\nViele Grüße\nIhr Beratungsteam";

/**
 * One definition per key, shared across channels: the WhatsApp and the email
 * variant carry the same message so a recipient who switches channel reads the
 * same thing. Email additionally gets the subject and a sign-off.
 */
const DEFINITIONS: readonly TemplateDefinition[] = [
  {
    key: "task_confirm_availability",
    subject: "Ihre Verfügbarkeit für die geförderte Weiterbildung",
    body: "Hallo {{firstName}}, für die geförderte Weiterbildung brauchen wir noch eine kurze Rückmeldung zu Ihrer Verfügbarkeit (ca. 20 Stunden pro Woche über 6 Monate). Das dauert zwei Minuten:\n\n{{link}}",
  },
  {
    key: "task_start_aptitude_test",
    subject: "Ihr Eignungstest ist bereit",
    body: "Hallo {{firstName}}, Ihr Eignungstest ist freigeschaltet. Sie brauchen dafür rund 30 Minuten und können jederzeit starten:\n\n{{link}}",
  },
  {
    key: "task_request_correct_contact",
    subject: "Bitte prüfen Sie Ihre Kontaktdaten",
    body: "Hallo {{firstName}}, wir konnten Sie unter der hinterlegten Nummer nicht erreichen. Bitte prüfen und ergänzen Sie kurz Ihre Kontaktdaten, damit wir Sie zurückrufen können:\n\n{{link}}",
  },
  {
    key: "task_confirm_reachability",
    subject: "Wann erreichen wir Sie am besten?",
    body: "Hallo {{firstName}}, wir haben Sie leider nicht erreicht. Sagen Sie uns kurz, wann und unter welcher Nummer wir Sie am besten zurückrufen dürfen:\n\n{{link}}",
  },
  {
    key: "task_reschedule_after_no_show",
    subject: "Neuen Termin für Ihre Beratung wählen",
    body: "Hallo {{firstName}}, Ihr letzter Beratungstermin hat leider nicht geklappt. Wählen Sie hier einen neuen Termin, der Ihnen besser passt:\n\n{{link}}",
  },
  {
    key: "task_give_consent",
    subject: "Einwilligung für Ihren Förderantrag",
    body: "Hallo {{firstName}}, damit wir Ihren Förderantrag vorbereiten dürfen, benötigen wir Ihre Einwilligung zur Verarbeitung Ihrer Daten. Sie können sie hier erteilen:\n\n{{link}}",
  },
  {
    key: "task_upload_documents",
    subject: "Unterlagen für Ihren Förderantrag",
    body: "Hallo {{firstName}}, für Ihren Förderantrag fehlen noch Unterlagen. Sie können sie hier direkt hochladen:\n\n{{link}}",
  },
  {
    key: "task_sign_document",
    subject: "Dokument zur Unterschrift",
    body: "Hallo {{firstName}}, für Ihren Förderantrag liegt ein Dokument zur Unterschrift bereit: {{title}}. Sie können es hier prüfen und unterschreiben:\n\n{{link}}",
  },
  {
    key: "task_confirm_submission",
    subject: "Bitte bestätigen Sie die Einreichung",
    body: "Hallo {{firstName}}, bitte bestätigen Sie kurz, dass die Unterlagen bei der Agentur für Arbeit eingereicht wurden:\n\n{{link}}",
  },
  {
    key: "task_provide_betriebsnummer",
    subject: "Betriebsnummer für den Förderantrag",
    body: "Hallo {{firstName}}, für den Förderantrag Ihrer Mitarbeiterin oder Ihres Mitarbeiters fehlt noch die Betriebsnummer Ihres Unternehmens. Sie können sie hier eintragen:\n\n{{link}}",
  },
  {
    key: "task_confirm_ags_status",
    subject: "Angaben zur Betriebsgröße",
    body: "Hallo {{firstName}}, für den Förderantrag benötigen wir noch Ihre Angabe zur Betriebsgröße (Zahl der Beschäftigten). Sie können sie hier ergänzen:\n\n{{link}}",
  },
  {
    key: "task_confirm_time_model",
    subject: "Freistellung und Arbeitszeitmodell",
    body: "Hallo {{firstName}}, bitte bestätigen Sie kurz das Arbeitszeitmodell und die Freistellung für die Weiterbildung:\n\n{{link}}",
  },
  {
    key: "task_employer_setup",
    subject: "Angaben Ihres Unternehmens für den Förderantrag",
    body: "Hallo {{firstName}}, für den Förderantrag brauchen wir einige Angaben zu Ihrem Unternehmen. Der Assistent führt Sie in wenigen Schritten durch die Felder:\n\n{{link}}",
  },
  // No landing page: an appointment reminder is informational, so it must not
  // promise a link the recipient cannot use.
  {
    key: "task_appointment_reminder",
    subject: "Erinnerung an Ihren Beratungstermin",
    body: "Hallo {{firstName}}, wir erinnern Sie an Ihren Beratungstermin. Falls es Ihnen nicht passt, geben Sie uns bitte kurz Bescheid.",
  },
  {
    key: "appointment_reminder_24h",
    subject: "Ihr Beratungstermin morgen",
    body: "Hallo {{firstName}}, Ihr Beratungstermin findet morgen statt. Falls Sie verhindert sind, geben Sie uns bitte kurz Bescheid.",
  },
  {
    key: "appointment_reminder_2h",
    subject: "Ihr Beratungstermin in Kürze",
    body: "Hallo {{firstName}}, Ihr Beratungstermin steht in Kürze an. Wir freuen uns auf das Gespräch.",
  },
  {
    key: "test_reminder_24h",
    subject: "Erinnerung: Ihr Eignungstest",
    body: "Hallo {{firstName}}, Ihr Eignungstest wartet noch auf Sie. Er dauert rund 30 Minuten:\n\n{{link}}",
  },
  {
    key: "test_reminder_48h",
    subject: "Letzte Erinnerung: Ihr Eignungstest",
    body: "Hallo {{firstName}}, Ihr Eignungstest ist weiterhin offen. Bitte holen Sie ihn in den nächsten Tagen nach, damit Ihr Antrag weiterlaufen kann:\n\n{{link}}",
  },
  {
    key: "signature_reminder_24h",
    subject: "Erinnerung: Dokument zur Unterschrift",
    body: "Hallo {{firstName}}, ein Dokument wartet noch auf Ihre Unterschrift: {{title}}. Sie können es hier unterschreiben:\n\n{{link}}",
  },
  {
    key: "signature_reminder_72h",
    subject: "Letzte Erinnerung: Dokument zur Unterschrift",
    body: "Hallo {{firstName}}, ohne Ihre Unterschrift können wir den Antrag nicht einreichen: {{title}}. Sie können das Dokument hier unterschreiben:\n\n{{link}}",
  },
  {
    key: GENERIC_REMINDER_TEMPLATE_KEY,
    subject: "Erinnerung: offener Schritt in Ihrem Antrag",
    body: "Hallo {{firstName}}, ein Schritt in Ihrem Förderantrag ist noch offen: {{title}}. Bitte melden Sie sich kurz bei uns.",
  },
];

export const MESSAGE_TEMPLATE_CATALOG = DEFINITIONS;

/** `task_<type>` — the key the routing engine and manual send ask for. */
export const buildTaskTemplateKey = (taskType: string): string => `task_${taskType}`;

/** Every template key the running application can request. */
export const listRequiredTemplateKeys = (): readonly string[] => [
  ...EXTERNAL_TASK_TYPES.map(buildTaskTemplateKey),
  ...REMINDER_TEMPLATE_KEYS,
  GENERIC_REMINDER_TEMPLATE_KEY,
];

export const hasLandingPage = (taskType: string): boolean =>
  (TASK_TYPES_WITH_LANDING_PAGE as readonly string[]).includes(taskType);

export type TemplateRow = {
  readonly key: string;
  readonly channel: MessageTemplateChannel;
  readonly subject: string | null;
  readonly body: string;
};

/** Expands the catalog into one row per channel, ready for insert. */
export const buildTemplateRows = (): readonly TemplateRow[] =>
  DEFINITIONS.flatMap((definition) =>
    MESSAGE_CHANNELS.map((channel) => ({
      key: definition.key,
      channel,
      subject: channel === "email" ? definition.subject : null,
      body:
        channel === "email" ? `${definition.body}${EMAIL_SIGN_OFF}` : definition.body,
    })),
  );
