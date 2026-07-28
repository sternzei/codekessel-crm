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
      "Eigene Entwürfe im Postausgang kontrollieren (Freigabe erfolgt durch Teamleitung/Admin).",
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
    title: "WhatsApp: Entwurf → Freigabe → Versand",
    summary:
      "Berater:innen queue’n Nachrichten; Teamleitung/Admin genehmigt. Self-Approval ist nicht erlaubt.",
    category: "messages",
    roles: ["consultant", "manager", "admin"],
    route: "/outbox",
    steps: [
      "Auf der Aufgabe „WhatsApp“ wählen — Nachricht landet im Postausgang.",
      "Teamleitung oder Admin öffnet den Postausgang.",
      "Inhalt prüfen → Genehmigen, Ablehnen oder Abbrechen.",
      "Nur eine Freigabe löst den Versand aus (atomar gesichert).",
    ],
    outcome: "Eine Nachricht, ein Versand — Trennung von Entwurf und Freigabe.",
    tips: [
      "Ersteller:innen können die eigene Nachricht nicht selbst freigeben.",
      "Click-to-Chat (wa.me) bleibt ein manueller Nebenweg ohne Cloud-API.",
    ],
    keywords: ["whatsapp", "postausgang", "outbox", "freigabe", "genehmigen"],
  },
  {
    id: "click-to-chat",
    title: "Click-to-Chat (manuell)",
    summary:
      "WhatsApp im Browser/Client öffnen — der Versand bleibt manuell bei Ihnen.",
    category: "messages",
    roles: ["consultant", "manager", "admin"],
    route: "/tasks",
    steps: [
      "Telefonnummer am Lead prüfen.",
      "Click-to-Chat / WhatsApp öffnen.",
      "Text im WhatsApp-Client prüfen und manuell senden.",
    ],
    outcome: "Schneller Kontakt ohne Freigabe-Pfad.",
    keywords: ["wa.me", "click", "chat", "manuell", "telefon"],
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
    title: "Team steuern: KPIs, Engpässe, Freigaben",
    summary:
      "Tenant-weiter Überblick für Teamleitung — Reports, Pipeline und Postausgang.",
    category: "routine",
    roles: ["manager", "admin"],
    route: "/reports",
    steps: [
      "Berichte öffnen: Funnel und Engpässe prüfen.",
      "Pipeline nach Last und Alterung scannen.",
      "Postausgang freigeben (ohne Self-Approval).",
      "Bei Bedarf Leads oder Aufgaben neu zuweisen.",
    ],
    outcome: "Führung hat Überblick; Freigaben bleiben Pflicht vor Cloud-Send.",
    keywords: ["manager", "kpi", "reports", "team", "freigabe"],
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
