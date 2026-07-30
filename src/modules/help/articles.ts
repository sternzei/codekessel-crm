import type { HelpArticle, HelpCategory, HelpRole } from "./types";

export const HELP_CATEGORY_LABELS: Record<HelpCategory, string> = {
  routine: "Tagesablauf",
  leads: "Leads & Pipeline",
  messages: "Nachrichten",
  documents: "Dokumente & Anträge",
  appointments: "Termine",
  admin: "Administration",
};

export const HELP_ROLE_LABELS: Record<HelpRole | "all", string> = {
  all: "Alle Rollen",
  consultant: "Berater:in",
  manager: "Teamleitung",
  admin: "Administration",
};

/** Curated in-product help — only operator journeys, not redesign/engineering docs. */
export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    id: "daily-consultant",
    title: "Tagesroutine als Berater:in",
    summary:
      "So arbeiten Sie die Queue ab: Pipeline, Aufgaben, Postausgang und Dokumenten-Lücken.",
    category: "routine",
    roles: ["consultant", "manager", "admin"],
    route: "/pipeline",
    steps: [
      "Pipeline öffnen und Schnellfilter nutzen (Erstkontakt, Pool, eigene Leads).",
      "Offene Aufgaben unter Aufgaben prüfen — Überfällige zuerst.",
      "Offene WhatsApp-Folgeschritte unter Aufgaben mit „WhatsApp senden“ auslösen.",
      "Unter Dokumente und Anträge Blocker schließen.",
    ],
    outcome: "Jeder aktive Lead hat einen klaren nächsten Schritt.",
    tips: [
      "Nutzen Sie „Nicht zugewiesen“, um Pool-Leads zu claimen, bevor Sie schreiben.",
    ],
    keywords: ["routine", "tag", "berater", "queue", "pipeline"],
  },
  {
    id: "claim-pool",
    title: "Lead aus dem Pool übernehmen (Claim)",
    summary:
      "Unzugeordnete Leads müssen Sie zuerst übernehmen, bevor Status, Notiz oder Nachricht möglich sind.",
    category: "leads",
    roles: ["consultant"],
    route: "/pipeline?consultant=unassigned",
    steps: [
      "In der Pipeline „Nicht zugewiesen“ filtern.",
      "Lead öffnen und übernehmen (Claim).",
      "Erst danach Status, Notiz, Aufgabe oder Nachricht ändern.",
    ],
    outcome: "Klare Ownership — keine stillen Schreibfehler auf fremde Leads.",
    tips: ["Teamleitung kann Leads jederzeit neu zuweisen."],
    keywords: ["claim", "pool", "unassigned", "übernehmen", "ownership"],
  },
  {
    id: "qualify-lead",
    title: "Lead qualifizieren & Erstkontakt",
    summary:
      "Förderung und Verfügbarkeit prüfen, Status setzen und den nächsten Kontakt anlegen.",
    category: "leads",
    roles: ["consultant", "manager", "admin"],
    route: "/pipeline",
    steps: [
      "Lead in der Pipeline öffnen.",
      "Kontaktdaten und Förder-/Verfügbarkeitslage prüfen.",
      "Status setzen (z. B. Interessiert, Qualifiziert, Verloren).",
      "Aufgabe für den nächsten Kontakt anlegen oder WhatsApp vorbereiten.",
    ],
    outcome: "Der Lead steckt sichtbar im Funnel mit nächster Aktion.",
    keywords: ["qualifizieren", "status", "erstkontakt", "interessiert"],
  },
  {
    id: "whatsapp-approval",
    title: "WhatsApp: Link zustellen (bis Cloud API live ist)",
    summary:
      "Solange Meta/Cloud API nicht konfiguriert ist: WhatsApp öffnen und manuell senden. Firmennummer-Versand folgt später.",
    category: "messages",
    roles: ["consultant", "manager", "admin"],
    route: "/tasks",
    steps: [
      "Auf der Aufgabe „WhatsApp öffnen“ wählen.",
      "Vorausgefüllter Text inkl. Magic Link öffnet sich in WhatsApp (wa.me).",
      "Nachricht im WhatsApp-Client prüfen und manuell senden.",
      "Sobald Cloud API konfiguriert ist, erscheint stattdessen „WhatsApp senden“ (Firmennummer, ohne App).",
    ],
    outcome: "Teilnehmer:in erhält den Link; kein vorgetäuschter Cloud-Versand.",
    tips: [
      "Ohne WHATSAPP_ACCESS_TOKEN meldet das System keinen Firmen-Versand.",
      "Magic Links können alternativ kopiert und auf anderem Weg geteilt werden.",
    ],
    keywords: ["whatsapp", "wa.me", "öffnen", "firmennummer", "cloud", "magic link"],
  },
  {
    id: "magic-link",
    title: "Magic Links für Teilnehmer:innen",
    summary:
      "Zeitlich begrenzte Links für Datenbestätigung, Test und Arbeitgeber-Schritte — ohne Login.",
    category: "leads",
    roles: ["consultant", "manager", "admin"],
    route: "/tasks",
    steps: [
      "Passende Aufgabe öffnen und Magic Link ausstellen.",
      "Link kopieren oder über WhatsApp/E-Mail zustellen.",
      "Teilnehmer:in füllt das Formular aus.",
      "Aufgabe schließt sich; der nächste Schritt wird geroutet.",
    ],
    outcome: "Externe Schritte ohne CRM-Zugang; Fortschritt bleibt sichtbar.",
    tips: ["Abgelaufene Links neu ausstellen; widerrufene Links sind sofort ungültig."],
    keywords: ["magic", "link", "token", "teilnehmer", "formular"],
  },
  {
    id: "documents-readiness",
    title: "Dokumente prüfen & Antrags-Readiness",
    summary:
      "Checkliste verifizieren — erst dann ist der Antrag submissionsbereit.",
    category: "documents",
    roles: ["consultant", "manager", "admin"],
    route: "/documents",
    steps: [
      "Teilnehmer:in unter Dokumente öffnen.",
      "Uploads verifizieren oder Ablehnung mit Hinweis setzen.",
      "Readiness-Blocker prüfen.",
      "Unter Anträge den Status weiterführen.",
    ],
    outcome: "Keine Blind-Submission — Gating ist nachvollziehbar.",
    keywords: ["dokumente", "checkliste", "antrag", "readiness", "upload"],
  },
  {
    id: "appointments",
    title: "Termine planen und nachhalten",
    summary: "Termine anlegen, Ergebnis setzen und im Funnel sichtbar halten.",
    category: "appointments",
    roles: ["consultant", "manager", "admin"],
    route: "/appointments",
    steps: [
      "Termin unter Termine anlegen oder am Lead pflegen.",
      "Ergebnis setzen (wahrgenommen, verschoben, …).",
      "Wirkung in Pipeline/Berichten prüfen.",
    ],
    outcome: "Kalender und Funnel bleiben konsistent.",
    keywords: ["termin", "appointment", "kalender"],
  },
  {
    id: "manager-oversight",
    title: "Team steuern: KPIs und Engpässe",
    summary:
      "Tenant-weiter Überblick für Teamleitung — Reports, Pipeline und Aufgabenlast.",
    category: "routine",
    roles: ["manager", "admin"],
    route: "/reports",
    steps: [
      "Berichte öffnen: Funnel und Engpässe prüfen.",
      "Pipeline nach Last und Alterung scannen.",
      "Offene Folgeaufgaben (z. B. nach Verfügbarkeit bestätigt) im Blick behalten.",
      "Bei Bedarf Leads oder Aufgaben neu zuweisen.",
    ],
    outcome: "Führung hat Überblick; der Alltagsversand blockiert nicht auf Freigaben.",
    keywords: ["manager", "kpi", "reports", "team"],
  },
  {
    id: "register-import",
    title: "Register-Import (OpenRegister)",
    summary:
      "Als Admin Firmen/Leads importieren, Konflikte prüfen und frische Leads bereitstellen.",
    category: "admin",
    roles: ["admin"],
    route: "/leads/import",
    steps: [
      "Register-Import öffnen (nur Administration).",
      "Import starten und Deduplizierung abwarten.",
      "Ergebnis prüfen: neu / aktualisiert / übersprungen / Konflikt.",
      "Berater:innen sehen neue Leads in der Pipeline.",
    ],
    outcome: "Leads sind outreach-bereit; Import-Lauf ist nachvollziehbar.",
    keywords: ["import", "openregister", "register", "csv", "admin"],
  },
];

export const listHelpArticlesForRole = (
  role: HelpRole,
): readonly HelpArticle[] =>
  HELP_ARTICLES.filter((article) => article.roles.includes(role));
