#!/usr/bin/env node
/**
 * Builds a self-contained interactive HTML wiki:
 * - CRM Atlas (how-to / Betrieb)
 * - User Stories & End-to-End Workflows
 * - Page specs & redesign plan
 *
 * Output: docs/crm-wiki.html
 * Usage:  node scripts/build-crm-wiki.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outPath = join(root, "docs", "crm-wiki.html");

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const fileToPageId = (file) => {
  if (!file || file === "README.md") return "home";
  if (file.includes("01-grundlagen")) return "kapitel-1";
  if (file.includes("02-leads")) return "kapitel-2";
  if (file.includes("03-kommunikation")) return "kapitel-3";
  if (file.includes("04-betrieb")) return "kapitel-4";
  if (file.includes("02a-rollen")) return "workflows";
  if (file.includes("02b-seitenspez")) return "pages";
  if (file.includes("crm-redesign/README")) return "redesign";
  if (file.includes("01-marke")) return "brand-audit";
  return slugify(file.replace(/\.md$/, ""));
};

const inline = (text) => {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safeHref = escapeHtml(href);
    if (href.startsWith("./") || href.includes(".md")) {
      const clean = href.replace(/^\.\//, "").split("#");
      const file = clean[0];
      const hash = clean[1] || "";
      const pageId = fileToPageId(file);
      const target = hash ? `${pageId}/${slugify(hash)}` : pageId;
      return `<a href="#/${escapeHtml(target)}" data-wiki-link>${label}</a>`;
    }
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return html;
};

const markdownToHtml = (md, pageId) => {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const toc = [];
  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeBuf = [];
  let listType = null;
  let tableBuf = [];

  const closeList = () => {
    if (!listType) return;
    html.push(listType === "ol" ? "</ol>" : "</ul>");
    listType = null;
  };

  const flushTable = () => {
    if (tableBuf.length < 2) {
      tableBuf = [];
      return;
    }
    const rows = tableBuf.map((row) =>
      row
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
    const [header, ...body] = rows;
    html.push('<div class="table-wrap"><table>');
    html.push("<thead><tr>");
    for (const cell of header) html.push(`<th>${inline(cell)}</th>`);
    html.push("</tr></thead><tbody>");
    for (const row of body) {
      if (row.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
      html.push("<tr>");
      for (const cell of row) html.push(`<td>${inline(cell)}</td>`);
      html.push("</tr>");
    }
    html.push("</tbody></table></div>");
    tableBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      closeList();
      flushTable();
      if (!inCode) {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeBuf = [];
      } else {
        html.push(
          `<pre><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join("\n"))}</code></pre>`,
        );
        inCode = false;
        codeLang = "";
        codeBuf = [];
      }
      i += 1;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i += 1;
      continue;
    }
    if (line.trim().startsWith("|")) {
      closeList();
      tableBuf.push(line);
      i += 1;
      continue;
    }
    if (tableBuf.length) flushTable();
    if (/^---+$/.test(line.trim())) {
      closeList();
      html.push("<hr />");
      i += 1;
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const text = heading[2].replace(/#+\s*$/, "").trim();
      const id = `${pageId}--${slugify(text)}`;
      if (level <= 3) toc.push({ level, text, id });
      html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i += 1;
      continue;
    }
    const ol = /^(\d+)\.\s+(.+)$/.exec(line);
    const ul = /^[-*]\s+(.+)$/.exec(line);
    if (ol || ul) {
      const type = ol ? "ol" : "ul";
      if (listType !== type) {
        closeList();
        html.push(type === "ol" ? "<ol>" : "<ul>");
        listType = type;
      }
      html.push(`<li>${inline((ol ? ol[2] : ul[1]).trim())}</li>`);
      i += 1;
      continue;
    }
    closeList();
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.startsWith("> ")) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quote.push(lines[i].slice(2));
        i += 1;
      }
      html.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
      continue;
    }
    html.push(`<p>${inline(line.trim())}</p>`);
    i += 1;
  }
  closeList();
  flushTable();
  return { html: html.join("\n"), toc };
};

/** Curated interactive user stories (German) for quick browsing */
const USER_STORIES = [
  {
    id: "import-leads",
    title: "Register-Import → neue Leads in der Pipeline",
    role: "admin",
    roles: ["admin"],
    status: "implemented",
    route: "/leads/import → /pipeline",
    summary:
      "Als Admin importiere ich Firmen/Leads aus OpenRegister, prüfe Konflikte und stelle Berater:innen frische Leads bereit.",
    steps: [
      "Admin öffnet /leads/import",
      "CSV/Import starten, Dedup auf (tenant_id, register_id)",
      "Ergebnis prüfen: neu / aktualisiert / übersprungen / Konflikt",
      "Berater:in sieht neue Leads in /pipeline",
    ],
    outcome: "Leads sind outreach-bereit; Import-Freshness sichtbar.",
  },
  {
    id: "qualify-lead",
    title: "Lead qualifizieren & Erstkontakt anstoßen",
    role: "consultant",
    roles: ["consultant", "manager"],
    status: "implemented",
    route: "/pipeline → /leads/[id] → /tasks",
    summary:
      "Als Berater:in prüfe ich Förderung/Verfügbarkeit, setze Status und lege den nächsten Kontakt-Task an.",
    steps: [
      "Lead in Pipeline öffnen (zugewiesen oder Pool claimen)",
      "Eligibility prüfen (Förderung, Zeitmodell)",
      "Status setzen (z. B. interested / qualified / lost)",
      "Kontakt-Task / Outreach vorbereiten",
    ],
    outcome: "Lead steckt klar im Funnel; nächste Aktion ist sichtbar.",
  },
  {
    id: "claim-pool",
    title: "Unzugeordneten Lead aus dem Pool claimen",
    role: "consultant",
    roles: ["consultant"],
    status: "phase0",
    route: "/pipeline (Nicht zugewiesen)",
    summary:
      "Als Berater:in übernehme ich einen unzugeordneten Lead, bevor ich schreibe (Claim-before-write).",
    steps: [
      "Filter „Nicht zugewiesen“",
      "Lead öffnen / Claim auslösen",
      "Erst danach Status, Notiz, Task oder Message ändern",
    ],
    outcome: "Ownership klar; keine stillen Schreibversuche auf fremde Leads.",
  },
  {
    id: "whatsapp-approval",
    title: "WhatsApp entwerfen → Manager genehmigt → Versand",
    role: "manager",
    roles: ["consultant", "manager", "admin"],
    status: "implemented",
    route: "/tasks → /outbox",
    summary:
      "Als Berater:in queue ich eine Nachricht; als Manager/Admin genehmige ich (kein Self-Approval) und der Adapter versendet einmal.",
    steps: [
      "Berater:in: Task → WhatsApp senden → Outbox (pending_approval)",
      "Manager/Admin öffnet /outbox",
      "Prüfen → Genehmigen / Ablehnen / Abbrechen",
      "Atomic CAS: nur ein Approver dispatch’t",
    ],
    outcome: "Eine Nachricht, ein Versand; Trennung von Erstellung und Freigabe.",
  },
  {
    id: "click-to-chat",
    title: "Click-to-Chat (manuell, ohne Cloud-API)",
    role: "consultant",
    roles: ["consultant", "manager", "admin"],
    status: "implemented",
    route: "/tasks oder Lead-Detail",
    summary:
      "Als Berater:in öffne ich wa.me mit vorausgefülltem Text — Versand bleibt manuell im WhatsApp-Client.",
    steps: [
      "Telefonnummer vorhanden prüfen",
      "Click-to-Chat öffnen",
      "Im WhatsApp-Client manuell senden",
    ],
    outcome: "Schneller Kontakt ohne Outbox-Approval-Pfad.",
  },
  {
    id: "magic-link-onboarding",
    title: "Magic-Link Onboarding (Teilnehmer:in)",
    role: "participant",
    roles: ["consultant", "participant"],
    status: "implemented",
    route: "/t/[token] + Tasks",
    summary:
      "Als Teilnehmer:in bestätige ich Daten, Verfügbarkeit, Test und Arbeitgeber-Schritte über zeitlich begrenzte Links.",
    steps: [
      "Berater:in stellt Magic Link aus (Task)",
      "Teilnehmer:in öffnet Link, Formular ausfüllen",
      "Token burn / Multi-Use je Scope",
      "Nächster Task wird geroutet",
    ],
    outcome: "Externe Schritte ohne Login; Fortschritt im CRM sichtbar.",
  },
  {
    id: "documents-readiness",
    title: "Dokumente prüfen → Antrags-Readiness",
    role: "consultant",
    roles: ["consultant", "manager"],
    status: "implemented",
    route: "/documents → /applications",
    summary:
      "Als Berater:in verifiziere ich Uploads; erst wenn die Checkliste greift, ist der Antrag submissionsbereit.",
    steps: [
      "Checkliste unter /documents öffnen",
      "Uploads verifizieren oder ablehnen",
      "Readiness-Blockers prüfen",
      "Antrag unter /applications weiterführen",
    ],
    outcome: "Keine Blind-Submission; Gating ist nachvollziehbar.",
  },
  {
    id: "appointments",
    title: "Termine planen & nachhalten",
    role: "consultant",
    roles: ["consultant", "manager"],
    status: "implemented",
    route: "/appointments",
    summary:
      "Als Berater:in plane ich Termine und halte Status nach; Reports zählen historische Attribution korrekt.",
    steps: [
      "Termin anlegen / aktualisieren",
      "Ergebnis (wahrgenommen, verschoben, …) setzen",
      "In Reports/Pipeline den Effekt prüfen",
    ],
    outcome: "Kalender und Funnel bleiben konsistent.",
  },
  {
    id: "manager-oversight",
    title: "Manager: Pipeline & Freigaben steuern",
    role: "manager",
    roles: ["manager", "admin"],
    status: "partial",
    route: "/reports → /pipeline → /outbox",
    summary:
      "Als Manager sehe ich tenant-weit KPIs, Engpässe und genehmige Nachrichten; dediziertes Manager-Panel folgt in Phase 1+.",
    steps: [
      "/reports: Funnel & Engpässe",
      "/pipeline: Team-Last & Aging",
      "/outbox: Freigaben ohne Self-Approval",
      "Bei Bedarf Lead/Task neu zuweisen",
    ],
    outcome: "Führung hat Überblick; Freigaben sind Pflicht vor Cloud-Send.",
  },
  {
    id: "daily-consultant",
    title: "Tagesroutine Berater:in",
    role: "consultant",
    roles: ["consultant"],
    status: "implemented",
    route: "/pipeline → /tasks → /outbox → /documents",
    summary:
      "Als Berater:in arbeite ich die Queue ab: neue Leads, fällige Tasks, wartende Freigaben, Dokumenten-Lücken.",
    steps: [
      "Pipeline: Filter Erstkontakt / Pool / meine Leads",
      "Tasks: fällig & überfällig",
      "Outbox: eigene Drafts prüfen (Freigabe durch andere)",
      "Documents/Applications: Blockers schließen",
    ],
    outcome: "Kein Lead bleibt ohne nächsten Schritt.",
  },
];

const readMd = (relativePath) => {
  const full = join(root, relativePath);
  if (!existsSync(full)) {
    console.warn("Missing:", relativePath);
    return "";
  }
  return readFileSync(full, "utf8");
};

const pages = [
  {
    id: "home",
    group: "Atlas",
    title: "Start & Übersicht",
    file: "docs/crm-atlas/README.md",
    blurb: "Rollen-Einstieg, Status, Sicherheits-Hinweise",
  },
  {
    id: "stories",
    group: "User Stories",
    title: "User Stories & Journeys",
    file: null,
    blurb: "Interaktive Stories nach Rolle & Status",
    special: "stories",
  },
  {
    id: "workflows",
    group: "User Stories",
    title: "E2E Workflows (Detail)",
    file: "docs/crm-redesign/02a-rollen-ia-und-workflows.md",
    blurb: "Personas, IA, End-to-End Maps",
  },
  {
    id: "pages",
    group: "User Stories",
    title: "Seitenspezifikationen",
    file: "docs/crm-redesign/02b-seitenspezifikationen.md",
    blurb: "UI-Specs je Seite & Interaktion",
  },
  {
    id: "kapitel-1",
    group: "Atlas",
    title: "1 · Grundlagen & Navigation",
    file: "docs/crm-atlas/01-grundlagen-und-navigation.md",
    blurb: "Rollen, Auth, Navigation",
  },
  {
    id: "kapitel-2",
    group: "Atlas",
    title: "2 · Leads, Pipeline & Aufgaben",
    file: "docs/crm-atlas/02-leads-pipeline-und-aufgaben.md",
    blurb: "Lebenszyklus, Tasks, Routine",
  },
  {
    id: "kapitel-3",
    group: "Atlas",
    title: "3 · Kommunikation & Dokumente",
    file: "docs/crm-atlas/03-kommunikation-dokumente-und-antraege.md",
    blurb: "WhatsApp, Outbox, Magic Links",
  },
  {
    id: "kapitel-4",
    group: "Atlas",
    title: "4 · Betrieb & Playbooks",
    file: "docs/crm-atlas/04-betrieb-playbooks-und-support.md",
    blurb: "Admin-Runbooks, Health, Reports",
  },
  {
    id: "redesign",
    group: "Planung",
    title: "Redesign-Plan",
    file: "docs/crm-redesign/README.md",
    blurb: "Phasen, Owner-Entscheidungen, Scope",
  },
  {
    id: "brand-audit",
    group: "Planung",
    title: "Marke & UX-Audit",
    file: "docs/crm-redesign/01-marke-und-ux-audit.md",
    blurb: "Ist-Zustand, Brand, UX-Friction",
  },
];

const storiesHtml = `
  <div class="stories-controls">
    <label>Rolle
      <select id="story-role">
        <option value="all">Alle</option>
        <option value="consultant">Berater:in</option>
        <option value="manager">Manager</option>
        <option value="admin">Admin</option>
        <option value="participant">Teilnehmer:in</option>
      </select>
    </label>
    <label>Status
      <select id="story-status">
        <option value="all">Alle</option>
        <option value="implemented">Implementiert</option>
        <option value="phase0">Phase 0</option>
        <option value="partial">Teilweise / geplant</option>
      </select>
    </label>
    <p class="hint">Klick auf eine Story öffnet die Schritte. Vollständige Maps → Seite „E2E Workflows“.</p>
  </div>
  <div id="story-grid" class="story-grid"></div>
`;

const builtPages = pages.map((page) => {
  if (page.special === "stories") {
    return {
      ...page,
      html: storiesHtml,
      toc: USER_STORIES.map((story) => ({
        level: 2,
        text: story.title,
        id: `stories--${story.id}`,
      })),
    };
  }
  const md = readMd(page.file);
  const { html, toc } = markdownToHtml(md, page.id);
  return { ...page, html, toc };
});

const groups = [...new Set(pages.map((page) => page.group))];
const navHtml = groups
  .map((group) => {
    const items = builtPages
      .filter((page) => page.group === group)
      .map(
        (page) => `
      <a class="nav-item" href="#/${page.id}" data-page="${page.id}">
        <span class="nav-title">${escapeHtml(page.title)}</span>
        <span class="nav-blurb">${escapeHtml(page.blurb)}</span>
      </a>`,
      )
      .join("\n");
    return `<div class="nav-group"><div class="nav-group-label">${escapeHtml(group)}</div>${items}</div>`;
  })
  .join("\n");

const pageSections = builtPages
  .map(
    (page) => `
    <article class="wiki-page" id="page-${page.id}" data-page="${page.id}" hidden>
      <header class="page-hero">
        <p class="eyebrow">CodeKessel CRM Wiki · ${escapeHtml(page.group)}</p>
        <h1>${escapeHtml(page.title)}</h1>
        <p class="lede">${escapeHtml(page.blurb)}</p>
      </header>
      <aside class="page-toc">
        <strong>Auf dieser Seite</strong>
        <nav>
          ${page.toc
            .slice(0, 36)
            .map(
              (item) =>
                `<a class="toc-l${item.level}" href="#/${page.id}/${(item.id.split("--")[1] || "").replace(/"/g, "")}" data-anchor="${item.id}">${escapeHtml(item.text)}</a>`,
            )
            .join("\n")}
        </nav>
      </aside>
      <div class="page-body prose">
        ${page.html}
      </div>
    </article>`,
  )
  .join("\n");

const searchIndex = [
  ...builtPages.map((page) => ({
    id: page.id,
    title: page.title,
    text: `${page.title} ${page.blurb} ${page.html}`
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 16000),
  })),
  ...USER_STORIES.map((story) => ({
    id: `stories/${story.id}`,
    title: `Story: ${story.title}`,
    text: `${story.title} ${story.summary} ${story.steps.join(" ")} ${story.outcome} ${story.route} ${story.roles.join(" ")}`,
  })),
];

const documentHtml = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CodeKessel CRM Wiki — User Stories & Atlas</title>
  <style>
    :root {
      --ink: #f4eefc; --muted: #b9a8ce; --line: rgb(255 255 255 / 0.08);
      --accent: #8f14e0; --accent-soft: rgb(143 20 224 / 0.18);
      --ok: #3dbf7a; --warn: #e0a43a; --partial: #7aa2ff;
      --radius: 14px; --shadow: 0 18px 50px rgb(0 0 0 / 0.35);
      --font: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: var(--font); color: var(--ink);
      background:
        radial-gradient(900px 500px at 10% -10%, rgb(143 20 224 / 0.28), transparent 55%),
        radial-gradient(700px 420px at 100% 0%, rgb(88 20 140 / 0.22), transparent 50%),
        linear-gradient(180deg, #140d1c, #0f0b14 40%, #0c0911);
      line-height: 1.55;
    }
    a { color: #d7a8ff; text-decoration: none; }
    a:hover { color: #efd6ff; text-decoration: underline; }
    .shell { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 100dvh; }
    .sidebar {
      position: sticky; top: 0; height: 100dvh; overflow: auto;
      padding: 1.25rem 1rem 2rem; border-right: 1px solid var(--line);
      background: linear-gradient(180deg, rgb(23 17 31 / 0.96), rgb(15 11 20 / 0.96));
    }
    .brand {
      border-radius: var(--radius); padding: 1.1rem 1rem 1rem; margin-bottom: 1.1rem;
      background:
        radial-gradient(120% 100% at 90% -20%, rgb(143 20 224 / 0.45), transparent 55%),
        linear-gradient(160deg, #271735, #17111f 70%);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06);
    }
    .brand h1 { margin: 0; font-size: 1.15rem; }
    .brand p { margin: 0.35rem 0 0; color: var(--muted); font-size: 0.82rem; }
    .search, select {
      width: 100%; border: 1px solid var(--line); border-radius: 10px;
      background: #1e1629; color: var(--ink); padding: 0.7rem 0.8rem; font: inherit;
    }
    .search { margin-bottom: 1rem; }
    .search:focus, select:focus { outline: 2px solid rgb(143 20 224 / 0.55); border-color: transparent; }
    .nav-group { margin-bottom: 1rem; }
    .nav-group-label {
      font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--muted); margin: 0.4rem 0.5rem 0.45rem; font-weight: 700;
    }
    .nav-item {
      display: block; padding: 0.7rem 0.8rem; border-radius: 10px; color: var(--ink);
      margin-bottom: 0.3rem; border: 1px solid transparent;
    }
    .nav-item:hover { background: rgb(255 255 255 / 0.04); text-decoration: none; }
    .nav-item.active { background: var(--accent-soft); border-color: rgb(143 20 224 / 0.35); }
    .nav-title { display: block; font-weight: 650; font-size: 0.9rem; }
    .nav-blurb { display: block; color: var(--muted); font-size: 0.74rem; margin-top: 0.15rem; }
    .main { padding: 1.5rem 1.5rem 3rem; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: space-between; margin-bottom: 1rem; }
    .toolbar .meta { color: var(--muted); font-size: 0.85rem; }
    .btn {
      border: 1px solid var(--line); background: #1e1629; color: var(--ink);
      border-radius: 10px; padding: 0.55rem 0.8rem; font: inherit; cursor: pointer;
    }
    .wiki-page {
      display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 1.25rem; align-items: start;
    }
    .wiki-page[hidden] { display: none !important; }
    .page-hero, .page-body, .page-toc, .results {
      background: rgb(23 17 31 / 0.78); border: 1px solid var(--line);
      border-radius: var(--radius); box-shadow: var(--shadow);
    }
    .page-hero {
      grid-column: 1 / -1; padding: 1.4rem 1.5rem;
      background:
        radial-gradient(90% 120% at 100% 0%, rgb(143 20 224 / 0.22), transparent 50%),
        rgb(23 17 31 / 0.9);
    }
    .eyebrow {
      margin: 0; text-transform: uppercase; letter-spacing: 0.12em;
      font-size: 0.7rem; color: #d7a8ff; font-weight: 700;
    }
    .page-hero h1 { margin: 0.4rem 0 0.35rem; font-size: clamp(1.45rem, 2vw, 2rem); }
    .lede { margin: 0; color: var(--muted); }
    .page-toc { position: sticky; top: 1rem; padding: 1rem; order: 2; max-height: calc(100dvh - 2rem); overflow: auto; }
    .page-toc strong { display: block; margin-bottom: 0.6rem; font-size: 0.8rem; color: var(--muted); }
    .page-toc a {
      display: block; color: var(--muted); font-size: 0.78rem; padding: 0.28rem 0;
      border-left: 2px solid transparent; padding-left: 0.55rem;
    }
    .page-toc a:hover { color: var(--ink); border-left-color: var(--accent); text-decoration: none; }
    .toc-l3 { padding-left: 1rem !important; }
    .page-body { padding: 1.35rem 1.5rem 2rem; order: 1; }
    .prose h2 { margin-top: 2rem; font-size: 1.25rem; border-top: 1px solid var(--line); padding-top: 1.2rem; scroll-margin-top: 1rem; }
    .prose h3 { margin-top: 1.4rem; font-size: 1.05rem; scroll-margin-top: 1rem; }
    .prose p, .prose li { color: #ebe3f6; }
    .prose code, .prose pre { font-family: var(--mono); font-size: 0.84rem; }
    .prose code { background: rgb(255 255 255 / 0.06); padding: 0.1rem 0.35rem; border-radius: 6px; }
    .prose pre { overflow: auto; padding: 0.9rem 1rem; border-radius: 12px; background: #0b0810; border: 1px solid var(--line); }
    .prose pre code { background: transparent; padding: 0; }
    .table-wrap { overflow: auto; margin: 1rem 0; border: 1px solid var(--line); border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    th, td { padding: 0.65rem 0.75rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: rgb(255 255 255 / 0.03); }
    blockquote {
      margin: 1rem 0; padding: 0.8rem 1rem; border-left: 3px solid var(--accent);
      background: var(--accent-soft); border-radius: 0 10px 10px 0;
    }
    .results { padding: 1rem 1.2rem; margin-bottom: 1rem; }
    .results[hidden] { display: none; }
    .hit { display: block; padding: 0.7rem 0.2rem; border-bottom: 1px solid var(--line); color: var(--ink); }
    .hit span { display: block; color: var(--muted); font-size: 0.8rem; margin-top: 0.2rem; }
    .stories-controls {
      display: flex; flex-wrap: wrap; gap: 0.8rem; align-items: end; margin-bottom: 1.2rem;
    }
    .stories-controls label { display: grid; gap: 0.3rem; font-size: 0.78rem; color: var(--muted); min-width: 160px; }
    .stories-controls .hint { flex: 1 1 220px; margin: 0; color: var(--muted); font-size: 0.82rem; }
    .story-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.9rem; }
    .story-card {
      border: 1px solid var(--line); border-radius: 14px; background: #1a1224;
      padding: 1rem; cursor: pointer; text-align: left; color: inherit; font: inherit;
      transition: border-color 150ms ease, transform 150ms ease;
    }
    .story-card:hover { border-color: rgb(143 20 224 / 0.55); transform: translateY(-1px); }
    .story-card.open { border-color: rgb(143 20 224 / 0.7); background: #22162f; }
    .story-card h3 { margin: 0.35rem 0 0.4rem; font-size: 1rem; }
    .story-meta { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .badge {
      display: inline-flex; align-items: center; border-radius: 999px; padding: 0.15rem 0.5rem;
      font-size: 0.68rem; font-weight: 700; letter-spacing: 0.03em; border: 1px solid var(--line);
    }
    .badge.role { background: rgb(255 255 255 / 0.05); color: #efd6ff; }
    .badge.implemented { color: var(--ok); border-color: rgb(61 191 122 / 0.35); }
    .badge.phase0 { color: var(--warn); border-color: rgb(224 164 58 / 0.4); }
    .badge.partial { color: var(--partial); border-color: rgb(122 162 255 / 0.4); }
    .story-summary { margin: 0.45rem 0 0; color: var(--muted); font-size: 0.86rem; }
    .story-route { margin: 0.45rem 0 0; font-family: var(--mono); font-size: 0.75rem; color: #d7a8ff; }
    .story-details { display: none; margin-top: 0.85rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
    .story-card.open .story-details { display: block; }
    .story-details ol { margin: 0.4rem 0 0.7rem; padding-left: 1.15rem; }
    .story-details li { margin: 0.25rem 0; font-size: 0.9rem; }
    .story-outcome { margin: 0; font-size: 0.86rem; color: #efe6fb; }
    @media (max-width: 960px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { position: static; height: auto; }
      .wiki-page { grid-template-columns: 1fr; }
      .page-toc { position: static; order: 0; max-height: none; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <h1>CodeKessel CRM Wiki</h1>
        <p>User Stories · Workflows · Bedienungs-Atlas · Suche alles</p>
      </div>
      <label for="q" style="position:absolute;left:-9999px">Suche</label>
      <input id="q" class="search" type="search" placeholder="Story, Status, Seite, Rolle suchen…" autocomplete="off" />
      <nav>${navHtml}</nav>
    </aside>
    <main class="main">
      <div class="toolbar">
        <div class="meta">Offline · Hash-Routing · Quelle: <code>docs/crm-atlas/</code> + <code>docs/crm-redesign/</code></div>
        <div>
          <button class="btn" id="btn-stories" type="button">Zu User Stories</button>
          <button class="btn" id="btn-print" type="button">Drucken</button>
        </div>
      </div>
      <section id="results" class="results" hidden></section>
      ${pageSections}
    </main>
  </div>
  <script>
    const SEARCH_INDEX = ${JSON.stringify(searchIndex)};
    const USER_STORIES = ${JSON.stringify(USER_STORIES)};
    const pages = Array.from(document.querySelectorAll(".wiki-page"));
    const navItems = Array.from(document.querySelectorAll(".nav-item"));
    const results = document.getElementById("results");
    const searchInput = document.getElementById("q");

    const parseHash = () => {
      const raw = location.hash.replace(/^#\\/?/, "");
      const [page = "home", anchor = ""] = raw.split("/");
      return { page: page || "home", anchor };
    };

    const showPage = (pageId, anchor) => {
      pages.forEach((page) => { page.hidden = page.dataset.page !== pageId; });
      navItems.forEach((item) => { item.classList.toggle("active", item.dataset.page === pageId); });
      if (pageId === "stories") renderStories();
      if (anchor) {
        const el =
          document.getElementById(pageId + "--" + anchor) ||
          document.getElementById(anchor) ||
          document.querySelector('[id$="--' + CSS.escape(anchor) + '"]') ||
          document.querySelector('[data-story-id="' + CSS.escape(anchor) + '"]');
        if (el) {
          if (el.matches(".story-card")) el.classList.add("open");
          requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
        }
      } else {
        window.scrollTo({ top: 0 });
      }
    };

    const statusLabel = (status) => ({
      implemented: "Implementiert",
      phase0: "Phase 0",
      partial: "Teilweise / geplant",
    })[status] || status;

    const renderStories = () => {
      const grid = document.getElementById("story-grid");
      const roleSel = document.getElementById("story-role");
      const statusSel = document.getElementById("story-status");
      if (!grid || !roleSel || !statusSel) return;
      const role = roleSel.value;
      const status = statusSel.value;
      const list = USER_STORIES.filter((story) => {
        const roleOk = role === "all" || story.roles.includes(role) || story.role === role;
        const statusOk = status === "all" || story.status === status;
        return roleOk && statusOk;
      });
      grid.innerHTML = list.map((story) => \`
        <button type="button" class="story-card" id="stories--\${story.id}" data-story-id="\${story.id}" aria-expanded="false">
          <div class="story-meta">
            <span class="badge role">\${story.role}</span>
            <span class="badge \${story.status}">\${statusLabel(story.status)}</span>
          </div>
          <h3>\${story.title}</h3>
          <p class="story-summary">\${story.summary}</p>
          <p class="story-route">\${story.route}</p>
          <div class="story-details">
            <strong>Schritte</strong>
            <ol>\${story.steps.map((step) => "<li>" + step + "</li>").join("")}</ol>
            <p class="story-outcome"><strong>Ergebnis:</strong> \${story.outcome}</p>
          </div>
        </button>
      \`).join("") || "<p>Keine Stories für diesen Filter.</p>";
      grid.querySelectorAll(".story-card").forEach((card) => {
        card.addEventListener("click", () => {
          const open = card.classList.toggle("open");
          card.setAttribute("aria-expanded", open ? "true" : "false");
          if (open) history.replaceState(null, "", "#/stories/" + card.dataset.storyId);
        });
      });
    };

    const runSearch = (query) => {
      const q = query.trim().toLowerCase();
      if (!q) {
        results.hidden = true;
        results.innerHTML = "";
        return;
      }
      const hits = SEARCH_INDEX.map((item) => {
        const hay = (item.title + " " + item.text).toLowerCase();
        const idx = hay.indexOf(q);
        if (idx < 0) return null;
        const start = Math.max(0, idx - 50);
        const snippet = (item.title + " — " + item.text).slice(start, start + 170);
        return { id: item.id, title: item.title, snippet };
      }).filter(Boolean).slice(0, 40);
      results.hidden = false;
      results.innerHTML = hits.length
        ? "<strong>" + hits.length + " Treffer</strong>" + hits.map((hit) =>
            '<a class="hit" href="#/' + hit.id + '"><strong>' + hit.title + '</strong><span>' +
            hit.snippet.replace(/</g, "&lt;") + "…</span></a>"
          ).join("")
        : "<p>Keine Treffer.</p>";
    };

    window.addEventListener("hashchange", () => {
      const { page, anchor } = parseHash();
      showPage(page, anchor);
    });
    searchInput.addEventListener("input", (event) => runSearch(event.target.value));
    document.getElementById("btn-print").addEventListener("click", () => window.print());
    document.getElementById("btn-stories").addEventListener("click", () => { location.hash = "#/stories"; });
    document.addEventListener("change", (event) => {
      if (event.target && (event.target.id === "story-role" || event.target.id === "story-status")) {
        renderStories();
      }
    });

    if (!location.hash) location.hash = "#/stories";
    else {
      const { page, anchor } = parseHash();
      showPage(page, anchor);
    }
  </script>
</body>
</html>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, documentHtml, "utf8");
console.log(`Wrote ${outPath} (${Math.round(Buffer.byteLength(documentHtml, "utf8") / 1024)} KB, ${builtPages.length} pages, ${USER_STORIES.length} stories)`);
