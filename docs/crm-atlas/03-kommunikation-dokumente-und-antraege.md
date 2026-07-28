# 3. Kommunikation, Dokumente und Anträge

**Statusdatum:** 28. Juli 2026  
**Zielgruppe:** Interne Operatoren, Berater:innen, Systemadministrator:innen

---

## Übersicht: Die drei Säulen

Dieses Kapitel dokumentiert die Architektur und den Workflow von:

1. **WhatsApp/E-Mail-Versand:** Automatisierte Kommunikation über das Gating-System (Postausgang)
2. **Magic Links:** Stateless, tokenisierte externe Links für Task-Verläufe
3. **Dokumente, Signaturen und Anträge:** Dokumentenmanagement, Canvas-Signatur (eIDAS-Compliance ausstehend) und Antragstellung bei der BA

Alle drei Säulen arbeiten über das **Task-System** zusammen: ein Task triggert den Versand (→ Postausgang), vergeben Magic Links und speichert Dokumentenmetadata.

---

# 1. WhatsApp- und E-Mail-Versand via Postausgang

Quelle: `src/modules/messaging/`, `src/db/schema/outbound-messages.ts`

## 1.1 Kanäle und Adapter

Der Versand erfolgt über **ChannelAdapter**-Implementierungen (`src/modules/messaging/adapters.ts`). Pro Kanal gibt es einen Adapter, der zur Laufzeit durch `resolveAdapterMode()` gewählt wird:

| Kanal | Live-Adapter | Live benötigt | Fehlen­des Fallback |
|-------|-------------|--|---|
| WhatsApp | `WhatsAppCloudAdapter` | `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` | `MockAdapter` (Demo) |
| E-Mail | `ResendEmailAdapter` | `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | `MockAdapter` (Demo) |

### Mock-Modus (Demo)
- **Auslöser:** Keine Credentials konfiguriert
- **Verhalten:** `MockAdapter.send()` loggt nur eine PII-freie Zeile, gibt `{ ok: true }` zurück (OHNE `providerMessageId`)
- **Netzwerk:** Keine Anfragen, Demo/Dev immer sicher
- **Message Deliveries:** Keine Zeile wird erzeugt (nur im Live-Modus)

### Live WhatsApp
- **API-Ziel:** Meta Graph API, POST zu `/{phoneNumberId}/messages`
- **Nachrichtenmodi:**
  - **Freitext (Standard):** Text-Nachricht mit `preview_url: true`
  - **HSM-Template (optional):** Meta-genehmigtes Vorlagen-Format mit Position-Parametern, wenn `WHATSAPP_USE_TEMPLATES=true` und eine Mapping existiert
    - **Einsatz:** Vorlagen sind **erforderlich** für geschäftsinitiierte Nachrichten **außerhalb des 24-Stunden-Kundenfensters**
    - **Mapping:** `src/modules/messaging/whatsapp-templates.ts`, deterministisch pro Message-Key

- **Sender-Nummer:** `WHATSAPP_SENDER_NUMBER` (z. B. `+4915510151448`) – wird in der Postausgang-Vorschau angezeigt (nur informativ; die echte Adressierung erfolgt über `WHATSAPP_PHONE_NUMBER_ID`, Metas technische ID)

### Live E-Mail
- **API-Ziel:** Resend API, POST zu `https://api.resend.com/emails`
- **Betreff:** Aus Template oder Fallback „Ihre nächste Aufgabe"
- **Format:** Text-Email

## 1.2 Click-to-Chat (wa.me) vs. API-Versand

### Click-to-Chat: manuell, nicht gated
- **Werkzeug:** `src/modules/messaging/click-to-chat.ts` (`toWaMeNumber`, `buildWaMeUrl`)
- **Ablauf:** Berater:in öffnet einen `wa.me/{international_digits}?text=...` Deep Link, der eine WhatsApp-Chat-Entwurf mit vorgefülltem Text öffnet – **von der Berater:in aus ihrem eigenen WhatsApp** versendet
- **Gating:** Keine – ein Entwurf öffnen ist bereits eine menschliche Handlung
- **Audit:** Nur `whatsapp_click_to_chat_opened` (Öffnen nachweisbar, nicht Zustellung)
- **Normalisierung:** Telefonnummern werden mit deutschem Trunk-„0" → Ländercode normalisiert, plausibilisiert (Min. 8 Ziffern)

### API-Versand: automatisiert, gated
- **Ablauf:** System → Postausgang-Queue → Mensch genehmigt → API → Delivery-Receipt
- **Sicherheit:** Keine Nachricht verlässt das System ohne explizite menschliche Genehmigung
- **Audit Trail:** `message_queued`, `message_approved`, `message_dispatched`, `message_dispatch_failed` etc.

## 1.3 Die Postausgang: Approval-Before-Send Gate

**Anforderung:** Kein System-Versand ohne explizite menschliche Genehmigung eines signiert angemeldeten Benutzers.

### Datenbankschema: `outbound_messages`

Quelle: `src/db/schema/outbound-messages.ts` (Migration `0012_early_shiva.sql`)

```sql
CREATE TABLE outbound_messages (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,           -- RLS scoped
  task_id UUID REFERENCES tasks.id,  -- NULL für Ad-hoc-Versand
  channel CHANNEL NOT NULL,          -- 'whatsapp' | 'email'
  template_key TEXT NOT NULL,        -- z. B. 'task_collect_sv_number'
  recipient_kind OWNER_KIND NOT NULL,-- 'participant' | 'employer'
  recipient_id UUID NOT NULL,
  
  -- Snapshot dessen, was versendet wird (für Vorschau + deterministischen Versand):
  recipient_phone TEXT,              -- Normalisiert oder NULL
  recipient_email TEXT,              -- Normalisiert oder NULL
  recipient_name TEXT,               -- Anzeigename für die Vorschau
  subject TEXT,                      -- Nur Email
  body TEXT NOT NULL,                -- Gerenderter, signaturverifier Text
  variables JSONB,                   -- Interpolationsvariablen (firstName, title, link, …)
  
  -- Status & Lifecycle
  status OUTBOUND_MESSAGE_STATUS,    -- 'pending_approval' | 'approved' | 'sending' | 'sent' | 
                                      -- 'delivered' | 'failed' | 'rejected' | 'cancelled'
  
  -- Menschliche Accountability
  approved_by_user_id UUID REFERENCES users.id,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejected_by_user_id UUID REFERENCES users.id,
  rejected_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  
  -- Nach dem Versand
  provider_message_id TEXT,          -- Meta message[0].id (für Delivery-Receipts)
  error_detail TEXT,                 -- Fehler bei fehlgeschlagenem Versand
  sent_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT outbound_messages_tenant_scope CHECK (tenant_id IS NOT NULL)
);

CREATE INDEX outbound_messages_status_idx ON outbound_messages(tenant_id, status);
CREATE INDEX outbound_messages_task_idx ON outbound_messages(tenant_id, task_id);
```

**Schlüsselprinzipien:**
- Jede Zeile snapshot exakt, was versendet wird (gerenderter Body, aufgelöste Adresse, Magic-Link-Payload)
- Tenant-Scoped mit **RLS** (Isolation Policy auf `qcg_app`)
- Distinct von `message_deliveries` (siehe unten), das Post-Dispatch-Provider-Receipts speichert
- Der `provider_message_id` (Meta `messages[0].id`) wird nach erfolgreichem Versand in `message_deliveries` gespiegelt

### Lifecycle: Zustandsmaschine

```
pending_approval ──approve──→ approved ──→ sending ──→ sent ──(Webhook)──→ delivered
       ↓                          ↓                         ↓
    reject ──→ rejected        cancel ──→ cancelled    error ──→ failed
       ↓
    cancel ──→ cancelled
```

**Zustandsübergänge (rein, aus `src/modules/messaging/outbound-status.ts`):**
- `pending_approval`: genehmigen [möglich], ablehnen [möglich], stornieren [möglich]
- `approved`: senden [möglich], stornieren [möglich]
- `sending`: erfolgreich → `sent`, Fehler → `failed`
- `sent`: Webhook-Receipt → `delivered`
- Terminal: `delivered`, `failed`, `rejected`, `cancelled`

### Alle drei System-Versandpfade: Enqueuing statt Dispatch

Die Funktion `enqueueTaskMessage()` (`src/modules/messaging/outbox.ts`) rendern den Template und schreiben **genau eine** `pending_approval`-Zeile – keine Versand.

| Versandpfad | Vorher | Nachher |
|---|---|---|
| Routing-Engine (Task-Erstellung) | direkt versendet | enqueued (pending) |
| Reminder-Worker | auto-versendet | enqueued (pending), Outcome = `queued` |
| Manuelle interne Action (Task-Versand-Button) | direkt versendet | enqueued (pending) → Redirect zu `/outbox` |

### Versand erfolgt NUR bei Genehmigung

`approveAndDispatch()` (`src/modules/messaging/outbox.ts`) ist der **EINZIGE** Code-Pfad, der einen Adapter aufruft:

1. Lade die pending-Zeile (tenant-scoped)
2. Validiere Status
3. Setze Status → `sending`, speichere `approved_by_user_id` + `approved_at`
4. Audit: `message_approved`
5. Rufe den Adapter auf → `SendResult { ok, providerMessageId?, error? }`
6. Aktualisiere Status → `sent` (ok) oder `failed` (Fehler)
7. Wenn erfolgreich und `providerMessageId` vorhanden: speichere in `message_deliveries`
8. Audit: `message_dispatched` oder `message_dispatch_failed`

**Server-Aktionen (session-guarded, tenant-scoped):**
- `approveMessage(formData)` – in `src/modules/outbox/actions.ts`
- `rejectMessage(formData)` – in `src/modules/outbox/actions.ts`
- `cancelMessage(formData)` – in `src/modules/outbox/actions.ts`
- UI: `/outbox` Seite listet alle pending Messages mit Recipient, Channel, Body-Vorschau + Buttons

**Operatorschritte:**
1. Öffne `/outbox`
2. Wähle eine pending-Nachricht
3. Prüfe Recipient, Channel, Body-Vorschau
4. Klicke "Genehmigen" (oder "Ablehnen"/"Stornieren")
5. Browser redirect zu `/outbox?result=dispatched` oder ähnlich

---

## ⚠️ BEKANNTE RACE-CONDITION: Concurrent Approve

**KRITISCHER HINWEIS FÜR PRODUKTIONSBEREITSCHAFT:**

Es existiert eine Race-Condition, bei der zwei **simultane Genehmigungen derselben Nachricht** (z. B. Double-Tap oder mehrere Tabs) beide `approveAndDispatch()` aufrufen, bevor der erste Schreibzugriff committed:

- **Szenario:** Operator klickt „Genehmigen", klickt sofort nochmal, bevor der erste DB-Update durchgeht
- **Folge:** Beide Transaktionen sehen `pending_approval`, beide schreiben `approved → sending` fast gleichzeitig
- **Resultat:** Nachricht wird **zweimal versendet** (Double-Dispatch) – die Meta API akzeptiert beide und weist zwei unterschiedliche `messages[0].id` zu

**Status:** Bekannt, **zur Behebung anstehend** (nicht in einem aktuellen PR implementiert)

**Workaround / Operator-Richtlinie:**
- **Einfach-Klick und Warten:** Klicke „Genehmigen" genau **einmal** und warte auf Page Redirect oder Bestätigung
- **Doppel-Taps vermeiden:** Der UI-Button sollte nach dem Klick deaktiviert werden (empfohlen: `disabled` setzen)
- **Produktionsfreigabe:** Diese Funktion ist für Production-Einsatz **NICHT freigegeben** bis die Race-Condition behoben ist

**Dauerhafte Lösung (geplant):**
- Verschiebe die Status-Prüfung in einen `FOR UPDATE`-Lock auf die Zeile (siehe `src/modules/signatures/finalize.ts` für das Muster)
- Oder: Implementiere einen Session/Browser-Level Double-Click-Schutz im UI

---

## 1.4 Delivery-Receipts: Inbound Webhook

Quelle: `src/modules/messaging/whatsapp-webhook.ts`, `src/modules/messaging/deliveries.ts`, `src/app/api/webhooks/whatsapp/route.ts`

### Webhook-Handshake (GET)

Meta sendet zuerst einen `GET` zum Webhook-Endpoint mit:
- `hub.mode=subscribe`
- `hub.verify_token=<der Token, den wir konfiguriert haben>`
- `hub.challenge=<beliebige Zeichenkette>`

**Validierung:**
```typescript
export function verifyWebhookChallenge(
  query: { mode, token, challenge },
  expectedToken: string
): string | null {
  if (!expectedToken) return null;  // Nicht konfiguriert
  if (query.mode !== "subscribe") return null;
  if (query.token !== expectedToken) return null;
  return query.challenge;           // Echo zurück
}
```

**Operatornote:** Der Token und die URL werden im WhatsApp Manager konfiguriert (außerhalb dieses Systems).

### Webhook-Signature-Validierung (POST)

Jede POST-Anfrage von Meta trägt einen `X-Hub-Signature-256`-Header:
```
X-Hub-Signature-256: sha256=<hex HMAC-SHA256 des Raw-Body mit App-Secret>
```

**Validierung (timing-safe):**
```typescript
export function isValidWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!appSecret) return false;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  // Constant-time Vergleich (Timing-Attack-sicher)
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
```

**Anforderungen:**
- `WHATSAPP_APP_SECRET` – Meta App Secret aus dem Meta Developer Dashboard
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` – Beliebiger String, im Manager konfiguriert

### Webhook-Payload: Status-Receipts und Inbound-Messages

Meta schickt beide in einem Call:
```json
{
  "entry": [{
    "changes": [{
      "value": {
        "statuses": [
          { "id": "wamid.xxx", "status": "delivered", "timestamp": "1719576000", "recipient_id": "491234567890" },
          ...
        ],
        "messages": [
          { "id": "msg.xxx", "from": "491234567890", "timestamp": "1719576100", "text": { "body": "Hallo!" } },
          ...
        ]
      }
    }]
  }]
}
```

**Parsing** (`parseWebhookEvents(payload)`):
- Durchsuche `entry[].changes[].value.statuses[]` → `WhatsAppStatusEvent` (Delivery-Lifecycle)
- Durchsuche `entry[].changes[].value.messages[]` → `WhatsAppInboundEvent` (Inbound-Repliken)
- Unbekannte Felder werden ignoriert (robust gegen Schema-Änderungen)

### Status-Receipt Events

**Zustand:** `sent`, `delivered`, `read`, `failed`

**Verarbeitung (in `src/modules/messaging/deliveries.ts`):**
1. Finde `message_deliveries`-Zeile nach `provider_message_id` (global eindeutig across WABAs)
2. Merge-Status monotonn (nur Vorwärts: `sent` → `delivered` → `read`, `failed` schlägt sofort `sent` weg, aber nicht von `delivered` auf `failed`)
3. Schreibe `status`, `[delivered|sent|read|failed]_at`, ggf. `error_detail`
4. Audit: `delivery_receipt_{status}`

**Datenbank:** `message_deliveries`-Tabelle

### Inbound-Reply Events

**Zweck:** Eine Inbound-Nachricht wird zur Laufzeit aufgezeichnet. Das System speichert `whatsappWindowExpiresAt` (Tenant-scoped, auf dem Task/Participant), basierend auf Meta's Spezifikation: 24 Stunden nach dem Inbound-Zeitstempel. Dies ist **dokumentiert, nicht automatisch erzwungen** – die Wahl zwischen Freetext vs. Template erfolgt global via `WHATSAPP_USE_TEMPLATES` (nicht pro Recipient).

**Externe Regel (Meta):** Business-initiated messages außerhalb des 24h-Fensters MÜSSEN ein genehmigtes Template (HSM) verwenden. Diese Regel liegt außerhalb des Systems; die App protokolliert nur das Fenster.

**Verarbeitung:**
1. Finde Participant nach `fromPhone`
2. Berechne `24h_window_expiry = occurredAt + 24 Stunden` (Meta's Spezifikation)
3. Speichere `whatsappWindowExpiresAt` auf dem Task/Participant
4. Audit: `inbound_message_received`

**Aktueller Konfigurationsverhalten:**
- `WHATSAPP_USE_TEMPLATES=true`: Alle Versände nutzen HSM-Templates (wenn Mapping existiert)
- `WHATSAPP_USE_TEMPLATES=false` oder nicht gesetzt: Alle Versände nutzen Freitext
- Pro-Recipient-Fenster-Prüfung: **GEPLANT** (empfohlen für Produktionsreife)

**Konfiguration:**
```
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<zufällig>
WHATSAPP_APP_SECRET=<aus Meta Developer Dashboard>
```

---

## 1.5 Konfiguration und Umgebungsvariablen

Quelle: `src/lib/env.ts`

### WhatsApp Live Mode
```bash
WHATSAPP_ACCESS_TOKEN=EAAxx...        # Meta Business Account Token
WHATSAPP_PHONE_NUMBER_ID=102xxx...    # Die WABA's Telefonnummer-ID (numerisch)
WHATSAPP_API_VERSION=v21.0            # Optional, default v21.0
WHATSAPP_SENDER_NUMBER=+4915510151448 # Informativ (für Postausgang-Anzeige)
WHATSAPP_USE_TEMPLATES=true           # HSM-Template-Modus (optional)
WHATSAPP_TEMPLATE_LANGUAGE=de         # Template-Sprache (default de)
```

### WhatsApp Webhook
```bash
WHATSAPP_WEBHOOK_VERIFY_TOKEN=secret-token
WHATSAPP_APP_SECRET=<aus Meta Developer Dashboard>
```

### Email Live Mode
```bash
RESEND_API_KEY=re_xxx...              # Resend API Key
RESEND_FROM_EMAIL=noreply@example.com
```

### Mock Mode (Standard)
- Keine Credentials → MockAdapter wird verwendet
- Alle Versände nur geloggt, keine Netzwerk-Anfragen

---

# 2. Magic Links: Externe, Sichere Task-Durchführung

Quelle: `src/modules/tokens/` (service.ts, policy.ts, link-status.ts)

## 2.1 Architektur: JWT + Hashed Storage

Magic Links sind die **einzige Möglichkeit für externe Nutzer (Teilnehmer, Arbeitgeber)**, das System zu berühren – sie öffnen keine App, bekommen keinen Account. Ein Link = Ein Task.

### Token-Format
- **JWT** (Jose, HS256) mit:
  - **Payload:** `tid` (tenantId), `scope` (Task-Typ), `sub` (subjectId), `jti` (unique UUID)
  - **Claims:** `iat`, `exp` (TTL-basiert)
- **Nicht-Persistierung des Raw-Token:** Nur der SHA-256-Hash wird gespeichert
- **URL:** `/t/{JWT}` (intern)

### Speicherung: `magic_link_tokens`-Tabelle

```sql
CREATE TABLE magic_link_tokens (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  task_id UUID NOT NULL REFERENCES tasks.id,
  subject_kind OWNER_KIND NOT NULL,  -- 'participant' | 'employer'
  subject_id UUID NOT NULL,
  scope TEXT NOT NULL,               -- Task-Type, z. B. 'provide_employer_phone'
  token_hash TEXT NOT NULL UNIQUE,   -- SHA-256(JWT), Single-Use-Anchor
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,  -- Burned on first use (F2: atomare Leseschreiboperation)
  revoked_at TIMESTAMP WITH TIME ZONE,-- Manuell widerrufen oder superseded
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX magic_link_tokens_task_idx ON magic_link_tokens(task_id);
```

## 2.2 Token-Lifecycle: Issuance, Multi-Use, Single-Use Burn

### Issuance: `issueMagicLink()`

```typescript
export async function issueMagicLink(tx, params: {
  tenantId: string;
  taskId: string;
  subjectKind: "participant" | "employer";
  subjectId: string;
  scope: string;  // Task type
  ttlHours?: number;
}): Promise<{ url: string; tokenId: string; expiresAt: Date }>
```

**Ablauf:**
1. TTL auflösen: expliziter Parameter > Env-Var (`MAGIC_LINK_TTL_HOURS`) > Default (7 Tage) – mit Clamping [1h, 30d]
2. JWT mit Jose signieren (HS256)
3. SHA-256-Hash des JWT speichern (nicht das Raw-Token)
4. Rückgabe: `https://app-base-url/t/{JWT}`

### TTL-Richtlinie

Quelle: `src/modules/tokens/policy.ts`

```typescript
export const DEFAULT_MAGIC_LINK_TTL_HOURS = 7 * 24;        // 7 Tage
export const MIN_MAGIC_LINK_TTL_HOURS = 1;                  // 1 Stunde
export const MAX_MAGIC_LINK_TTL_HOURS = 30 * 24;            // 30 Tage

// Resolvelogik:
// 1. Expliziter Parameter (per-Issuance)
// 2. Env-Var (Deployment-Standardwert)
// 3. Built-in Default (7 Tage)
// → Immer gepuffert auf [MIN, MAX]
```

**Operator-Konfiguration:**
```bash
MAGIC_LINK_TTL_HOURS=168   # 7 Tage (default)
```

### Multi-Use Scopes

Einige Flows erlauben mehrfaches Öffnen desselben Links (z. B. Eignungstest, Arbeitgeber-Setup-Assistent). Nach Task-Abschluss ist der Link dennoch dead.

```typescript
const MULTI_USE_SCOPES = new Set([
  "start_aptitude_test",           // Teilnehmer:in kann neu öffnen
  "provide_betriebsnummer",        // Arbeitgeber-Setup
  "confirm_ags_status",            // Arbeitgeber-Setup
  "confirm_time_model",            // Arbeitgeber-Setup
  "employer_setup",                // Arbeitgeber-Setup (Umbrella)
]);
```

**Logik:** Nach dem Öffnen wird das Token NICHT verbrannt; nur wenn der Task completed wird, sind alle Sibling-Tokens tot.

### Single-Use: Burn-First Ordering

**Kritisches Merkmal: Token wird ZUERST verbrannt, dann die Task-Mutation**

Quelle: `completeTaskViaToken()` in `src/modules/tokens/service.ts`

```typescript
export async function completeTaskViaToken(
  tx: DbHandle,
  ctx: { tokenRow: TokenRow; task: TaskRow }
): Promise<boolean> {
  // F2: Atomic burn – nur die Transaktion, die used_at von NULL → now setzt, siegt
  const burned = await markTokenUsed(tx, ctx.tokenRow);
  if (!burned) return false;  // Lost race, bereits verbrannt

  // Task → done
  await tx.update(tasks).set({ status: "done", completedAt: new Date() });
  
  // Audit + Cleanup
  await revokeUnusedTokensForTask(tx, ctx.task.id);
  await cancelScheduledRemindersForTask(tx, ctx.task.id);
  return true;
}
```

**Atomare Burn-Operation (F2):**
```sql
UPDATE magic_link_tokens
SET used_at = now()
WHERE id = ? AND used_at IS NULL
RETURNING id;
-- Nur der Winner erhält ein RETURNING-Ergebnis
```

**Double-Submit Protektion:** Ein Concurrent Double-Click (selbe Token, zwei Browser-Tabs) → erste Transaktion setzt `used_at`, zweite findet kein RETURNING-Ergebnis → gibt `false` zurück → keine doppelte Task-Completion.

## 2.3 Token-Validierung: Zwei Phasen

### Phase 1: Stateless (JWT-Signatur + TTL)

```typescript
export async function verifyTokenSignature(token: string)
  : Promise<{ tenantId: string } | null>
```

- Dekodiere JWT (Jose)
- Verifiziere HMAC-Signatur
- Prüfe Expiration
- Extrahiere Tenant-ID
- **Netzwerk-frei**, daher schnell für jeden Request

### Phase 2: Stateful (DB-Prüfung, Tenant-TX)

```typescript
export async function loadTokenContext(tx, token: string)
  : Promise<{ ok: true; tenantId; tokenRow; task } | 
            { ok: false; reason: "invalid" | "expired" | "used" | "revoked" | "task_closed" }>
```

- Hash-Match in der DB
- Prüfe `revoked_at` (NULL = nicht manuell widerrufen)
- Prüfe `used_at` (NULL = noch nicht verbrannt)
- Prüfe `expires_at` (< now = abgelaufen)
- Lade Task: Prüfe Status (`open`, `in_progress`, `waiting` = aktiv; `done`, `escalated`, `cancelled` = inaktiv) – **außer** für Multi-Use-Scopes
- Prüfe Task Status gegen `task_closed`-Gate (F1)

**Fehlergründe:**
- `invalid`: JWT falsch, DB-Hash passt nicht
- `expired`: `expires_at` überschritten
- `used`: `used_at` ist gesetzt (bereits verbrannt)
- `revoked`: `revoked_at` ist gesetzt (manuell widerrufen)
- `task_closed`: Task ist nicht mehr aktiv UND Scope ist NICHT in `MULTI_USE_SCOPES`

## 2.4 Token-Verwaltung: Issuance/Reuse, Superseding, Revocation

### Issuance/Re-Issuance: At Most One Valid Credential

**Principium:** Zu jedem Zeitpunkt ist **höchstens ein Token** pro Task gültig. Das Neuausstellen eines Links invalidiert den alten.

```typescript
export async function getOrIssueMagicLinkForTask(
  tx: DbHandle,
  task: TaskRow
): Promise<string | null>
```

**Ablauf:**
1. Falls Task intern (kein External Subject) → `null` zurück
2. Supersede alle noch-lebenden Tokens des Tasks → `revoke_unused_tokens_for_task`
3. Münze einen frischen Token → `issueMagicLink`
4. Rückgabe: neue URL

**Anwendungsfall:** Reminder-Worker sendet einen neuen Link 24h später → Altertum wird superseded

### Supersede: `revokeUnusedTokensForTask()`

```sql
UPDATE magic_link_tokens
SET revoked_at = now()
WHERE task_id = ? 
  AND used_at IS NULL          -- Nicht bereits verbrannt
  AND revoked_at IS NULL        -- Nicht bereits widerrufen
;
```

**Semantik:** Alle noch-lebenden Credentials werden für ungültig erklärt, so dass nur der neue Link gilt.

### Revocation: Operator-Gelegenheits-Widerruf

**Manuelle Revocation (z. B. wenn Operator feststellt, dass ein Link kompromittiert wurde):**

```typescript
export async function revokeToken(tx, tokenId: string): Promise<void>
```

- Setze `revoked_at = now()` auf die Zeile
- Audit: `token_revoked`

**Listenoperation:** `listLiveTokenIdsForTask(taskId)` liefert alle noch aktiven Token-IDs eines Tasks (unbenutz, nicht revoked, nicht abgelaufen)

### Link-Status für die Anzeige

```typescript
export type TaskLinkState = {
  hasLiveLink: boolean;       // Ein brauchbarer Link existiert
  revokedLinkCount: number;   // Wie viele wurden widerrufen/superseded
};

export type TaskLinkDisplayStatus = "active" | "revoked" | "none";

export function deriveTaskLinkDisplayStatus(state: TaskLinkState)
  : TaskLinkDisplayStatus
```

**UI-Anzeige:** Ein Operator sieht auf der Tasklist:
- `active`: Ein lebender Link existiert
- `revoked`: Keine lebenden Links, aber einige wurden widerrufen (Link war ungültig gemacht)
- `none`: Nie ein Link ausgestellt oder intern kein Magic-Link-Sinn

## 2.5 Rate Limiting und Throttle

Quelle: `src/modules/tokens/request-throttle.ts`, `src/lib/rate-limit.ts`

### Request-Throttle (Intra-Token-Level)

**Problem:** Ein Operator gibt die gleiche URL einem Teilnehmer mehrmals – die Pagina macht mehrere XHR-Calls im Sekundentakt. Ohne Throttle würde jeder Call `loadTokenContext()` + Mutation versuchen.

**Lösung:** In-Memory-Throttle-Set pro Token-Hash:
- Erste Anfrage: wird verarbeitet
- Nachfolgende Anfragen < 2 Sekunden: HTTP 429 (Too Many Requests)
- Nach 2s: Throttle-Eintrag verfällt, nächste Anfrage kann verarbeitet werden

```typescript
const THROTTLE_WINDOW_MS = 2000;
const throttledTokens = new Set<string>();

export function isTokenThrottled(tokenHash: string): boolean {
  if (throttledTokens.has(tokenHash)) return true;
  throttledTokens.add(tokenHash);
  setTimeout(() => throttledTokens.delete(tokenHash), THROTTLE_WINDOW_MS);
  return false;
}
```

### Generischer Rate-Limit (IP-Level)

Siehe `src/lib/rate-limit.ts` für Token-Bucket-Raten-Beschränkung pro Client-IP (falls aktiviert)

## 2.6 Sicherheits-Checklisten

### Für Support-Operatoren: Sicheres Umgang mit Links

**VORSICHT: Links sind genauso wertvoll wie Passwörter.**

- ✅ Link nur über Secure Channel senden (Messenger, E-Mail mit TLS, WhatsApp)
- ❌ Nicht in unverschlüsselte Chats oder Logs kopieren
- ✅ Link hat TTL (Standard 7 Tage) – erinnern Sie den Teilnehmer, ihn zeitnah zu öffnen
- ✅ Wenn ein Link kompromittiert ist (z. B. versehentlich gepostet): manuell widerrufen (Operator-UI → Token revoke)
- ❌ Einen Link nicht mehrfach an unterschiedliche Personen senden

### Für Entwickler:innen: Token-Handling

- ✅ SHA-256-Hash speichern, nie das Raw-JWT
- ✅ Token ist tenant-scoped (via JWT `tid` claim)
- ✅ Burn-First-Ordering implementiert (atomare `used_at`-Prüfung)
- ✅ TTL ist geclampet [1h, 30d], nicht konfigurierbar auf 0
- ✅ Jedes Sibling-Token wird beim Supersede-Event widerrufen
- ❌ Nicht: Raw-Token in Logs, Error-Responses oder Audit-Trail
- ✅ Audit-Einträge sind PII-arm (Scope, nicht der Link selbst)

---

# 3. Dokumente, Signaturen und Anträge

Quelle: `src/modules/documents/`, `src/modules/signatures/`, `src/modules/applications/`, `src/db/schema/documents.ts`

## 3.1 Dokumentenmanagement: Types, Status, Speicher

### Dokumenttypen

Zentral definiert in `src/modules/documents/actions.ts` (`DOC_TYPES`-Objekt), angeordnet nach Antragsweg:

#### Einzelantrag (eService 6 Schritte)
1. **`traegerbescheinigung`** (BA ba042369)
   - Status: [Implementiert] Autofill vollständig (15 Felder, verifiziert gegen echte Beispiele)
   - Generiert von `generateTraegerbescheinigung()`
   - Voraussetzung: `measure.startDate` (Maßnahme mit Beginn)
   - Signatur: **keine** (Träger: Nass-Unterschrift auf Papier)

2. **`eservice_single`**
   - Status: [Implementiert] Autofill vollständig (Begleitblatt mit Schritt-für-Schritt-Anleitung)
   - Generiert von `generateEServiceCompanionSingle()`
   - Voraussetzung: `employer` UND `measure`
   - Signatur: **keine**

3. **`arbeitnehmererklaerung`** (BA ba042354)
   - Status: [Mapping ausstehend] 16 Felder
   - Generiert von `generateArbeitnehmererklaerung()`
   - Voraussetzung: `employer` (braucht die Betriebsnummer)
   - Signatur: Canvas (technisch implementiert, rechtlich ausstehend) – **Teilnehmer:in**

4. **`vollmacht`** (BA ba051211)
   - Status: [Mapping ausstehend] 42 Felder
   - Generiert von `generateVollmacht()`
   - Voraussetzung: `employer`
   - Signatur: QES (Qualified Electronic – nicht angebunden) – **Teilnehmer:in**
   - **Blocker-Status:** QES-Lücke ist **Warnung**, nicht Blocker (kein QES-Anbieter angebunden)

5. **`fragebogen`** (BA ba046157)
   - Status: [Mapping ausstehend] 190 Felder
   - Generiert von `generateFragebogen()`
   - Voraussetzung: `measure`
   - Signatur: Canvas (technisch implementiert, rechtlich ausstehend) – **Teilnehmer:in**

#### Sammelantrag (eService 7 Schritte)
6. **`teilnehmerliste`** (BA I FW 501/502)
   - Status: [Implementiert] Kopfzeile + Teilnehmerzeilen (SV-Nummern leer – zentral nicht erfasst)
   - Generiert von `generateTeilnehmerliste()`
   - Voraussetzung: `employer` UND `measure`
   - Signatur: **keine** (Upload als Nachweis)
   - Besonderheit: Covers alle Teilnehmenden desselben Arbeitgebers + Maßnahme (Kohorten-Export)

7. **`eservice_company`**
   - Status: [Implementiert] Autofill vollständig (Begleitblatt für Sammelantrag)
   - Generiert von `generateEServiceCompanionCompany()`
   - Voraussetzung: `employer` UND `measure`
   - Signatur: **keine**

#### Interne Dokumente
8. **`participant_form`** (Muster Teilnehmer-Stammblatt)
   - Status: [Implementiert] Sample-Template (Platzhalter)
   - Generiert von `generateParticipantForm()`
   - Voraussetzung: `measure` UND `participant.dateOfBirth` UND `participant.street`
   - Signatur: **keine** (nur intern)

9. **`cost_overview`** (Kostenübersicht)
   - Status: [Implementiert] Generiert (Mode B: pdf-lib)
   - Generiert von `generateCostOverview()`
   - Voraussetzung: `measure.costEur`
   - Signatur: **keine**

10. **`employer_datasheet`** (Arbeitgeber-Datenblatt)
    - Status: [Implementiert] Generiert (Mode B: pdf-lib)
    - Generiert von `generateEmployerDatasheet()`
    - Voraussetzung: `employer`
    - Signatur: **keine**

### Document-Status-Maschine

```
data_missing ──generate──→ prefilled ──request sig──→ pending (implicit)
                                                              ↓
                                                        signed (technisch)
```

**Statuswerte** (diese sind technische Zustände, nicht rechtliche Validierungen):

- **`data_missing`**: Voraussetzung fehlt → Clarification Task erstellt
- **`prefilled`**: Datei existiert, kann signiert werden
- **`reviewed`**: (Geplant: Consultant Review)
- **`approved`**: (Geplant: QA-Gate)
- **`sent`**: (Geplant: BA-Submission)
- **`submitted`**: BA eService eingereicht
- **`partially_signed`**: >= 1 erforderliche Canvas-Unterschrift gesammelt, aber nicht alle
- **`signed`**: Alle erforderlichen Canvas-Unterschriften gesammelt + Audit-Artifact mit Stempel erstellt (rechtliche Gültigkeit ausstehend)

### Speicher: Lokal vs. S3

Quelle: `src/modules/storage/`

**Konfiguration:**
```bash
STORAGE_DRIVER=local|s3

# Local
# Auto: var/documents/...

# S3
S3_BUCKET=my-bucket
S3_REGION=eu-central-1
S3_ENDPOINT=https://minio.example.com  # Optional (self-hosted)
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true               # Für Self-Hosted/Minio
S3_KEY_PREFIX=qcg/                     # Optional
```

**Adaptive Logik:**
- `STORAGE_DRIVER=local` → `LocalStorageAdapter` → `var/documents/...` lokal
- `STORAGE_DRIVER=s3` + `S3_BUCKET` → `S3StorageAdapter` → S3 Bucket

**Speicherschlüssel:** Automatisch generiert mit `buildStorageKey()`:
```
documents/{timestamp}/{random}.pdf
```

### Datei-Upload-Validierung: Magic Bytes

Quelle: `src/lib/file-sniff.ts`

**Problem:** Client-gesendeter MIME-Type ist angriffsgesteuert. Echte Datei-Validierung basiert auf Magic Bytes.

```typescript
export function sniffUploadType(bytes: Uint8Array)
  : "application/pdf" | "image/png" | "image/jpeg" | null

// PDF:  %PDF-
// PNG:  89 50 4E 47 0D 0A 1A 0A
// JPEG: FF D8 FF
```

**Operatornote:** Nur PDF / PNG / JPEG erlaubt. Alles andere wird abgelehnt.

---

## 3.2 Signaturen: eIDAS SES (Canvas) Workflow

Quelle: `src/modules/signatures/`, Konzept: docs/ESERVICE-ANTRAG.md, Epic C

### Signatur-Anforderungen pro Dokument

Zentral definiert in `src/modules/signatures/requirements.ts`:

```typescript
export function getDocumentSignatureRequirement(docType: string)
  : DocumentSignatureRequirement | null
```

**Klassifizierung:**
- **null**: Keine Signatur nötig (z. B. Kostenübersicht, Träger-Begleitblatt)
- **SES (`canvas`)**: Canvas-basierte Unterschrift (eIDAS Simple Electronic Signature – technisch implementiert, rechtliche Gültigkeit ausstehend)
- **QES**: Qualified Signature (externer Anbieter, **nicht angebunden**, Fallback: Warnung)
- **None**: Nass-Unterschrift (z. B. Trägerbescheinigung – offline)

**Implementierung:**
| Dokument | Signer | Anforderung | Status |
|----------|--------|---|---|
| `arbeitnehmererklaerung` | Teilnehmer:in | Canvas-SES | Technisch implementiert |
| `fragebogen` | Teilnehmer:in | Canvas-SES | Technisch implementiert |
| `vollmacht` | Teilnehmer:in | QES (Blocker: Warnung, kein QES-Anbieter) | Canvas nicht angeboten, QES-Anbieter ausstehend |
| `traegerbescheinigung` | Träger | Nass (kein Canvas) | — |
| `teilnehmerliste` | — | Keine | — |

### Signature-Status-Maschine

```
pending ──sign──→ signed
        ──decline──→ declined
        ──expire──→ expired (bei TTL-Überschreitung)
```

```sql
CREATE TABLE signatures (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES documents.id,
  signer_kind OWNER_KIND NOT NULL,      -- 'participant' | 'employer'
  signer_participant_id UUID,           -- Falls Teilnehmer:in
  signer_employer_id UUID,              -- Falls Arbeitgeber
  provider TEXT NOT NULL,               -- 'canvas' (TODO: 'docusign', etc.)
  
  status SIGNATURE_STATUS,              -- pending | signed | declined | expired
  
  -- Signed Details
  signer_name TEXT,                     -- Name beim Signieren
  signed_at TIMESTAMP WITH TIME ZONE,
  ip_address TEXT,                      -- Client-IP beim Signieren
  signature_image_path TEXT,            -- Storage Key des gezogenen PNG (Canvas)
  
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
);
```

### Signatur-Anfrage: `requestSignature()`

```typescript
export async function requestSignature(formData: FormData): Promise<void>
```

**Ablauf (aus `src/modules/documents/actions.ts`):**
1. Lade Dokument (`documentId`) → Prüfe, dass `filePath` existiert
2. Validiere, dass der Dokument-Status NICHT bereits `signed` ist
3. **Signer-Klassifizierung:** Prüfe `canRequestCanvasSignature(docType, signerKind).allowed`
   - Falls QES erforderlich und Canvas angefordert → **blockiert** (keine Canvas für QES)
4. Setze `signerParticipantId` oder `signerEmployerId` genau (XOR-Logik)
5. Duplicate-Check: Suche existierende `signatures` für das Dokument + `signerKind`
   - Wenn bereits eine `pending` oder `signed` existiert → **abgelehnt** (Duplicate)
6. Erstelle `signatures`-Zeile mit `status: pending`, `provider: canvas`
7. Audit: `signature_requested`
8. **Routing:** Transitioniere auf `signatures` Entity mit Status `pending` → triggert Routing-Regel → Task + Magic Link wird erstellt

**Operatornote:**
- Klicke „Signatur anfragen" auf dem Dokument
- Wähle Signer (Teilnehmer:in oder Arbeitgeber) – nur wenn gültig für dieses Dokument
- System erzeugt einen Magic Link und schickt ihn via WhatsApp/E-Mail (gated, genehmigungspflichtig)
- **QES-Dokumente:** Fallback zu Warnung (kein Canvas-Button für QES-Klassifizierung)

### Canvas-Signatur: External Link-Aktion

**Route:** `/t/{token}/signature/{documentId}` (`src/app/t/[token]/signature/route.tsx`)

**Ablauf:**
1. Validiere Token (`loadTokenContext()`)
2. Lade Dokument + Signature-Zeile
3. Zeige Dokument-PDF im Browser (embedded oder Download-Link)
4. Canvas-Zeichenfläche: Teilnehmer:in zeichnet Unterschrift
5. **POST** Unterschrift-Image (PNG) + Metadaten:
   - Signer-Name (gerendert aus Token oder Feld)
   - Signaturzeit (`now()`)
   - Client-IP (`getClientIp()`)
6. Speichere PNG in S3/Local (Storage), erhalte `signatureImagePath`
7. Aktualisiere `signatures`-Zeile:
   - `status: signed`, `signer_name`, `signed_at`, `ip_address`, `signature_image_path`
8. Rufe `finalizeIfComplete(documentId)` auf: Wenn alle erforderlichen Canvas-Unterschriften vorhanden → Audit-Artifact generieren
9. Audit: `signature_signed`
10. Redirect: Task-Abschluss-Seite oder Danke-Seite

**Technischer Status:** Canvas-Unterschrift ist erfolgreich gesammelt und gestempelt. **Rechtliche Validierung (eIDAS-SES-Compliance) obliegt dem Deployment und ist ausstehend.**

### Signaturen-Finalisierung: Audit-Artifact

Quelle: `src/modules/signatures/finalize.ts`

**Trigger:** Nach jeder Canvas-Unterschrift → `finalizeIfComplete(documentId)`

```typescript
export async function finalizeIfComplete(tx, documentId)
  : Promise<{ finalized: boolean }>
```

**Ablauf:**
1. **FOR UPDATE** Lock auf Document-Zeile (serialisiere Concurrent Co-Signers)
2. Lade alle `signatures` für das Dokument
3. Prüfe mit `signatureProgress()`: Sind alle erforderlichen Canvas-Unterschriften `signed`?
4. Falls NEIN:
   - Setze Document Status → `partially_signed` (zumindest eine, aber nicht alle)
   - Return `{ finalized: false }`
5. Falls JA:
   - Rufe `generateSignedArtifact()` auf (PDF mit gestempelten Unterschriften + Audit-Seite)
   - Speichere signiertes Artifact → `signedFilePath`, `signedSha256`
   - Aktualisiere Document → `status: signed`
   - Audit: `document_signed`
   - Return `{ finalized: true }`

**`FOR UPDATE` Schutz:** Verhindert Race-Condition, bei der zwei Co-Signers gleichzeitig finalisieren

**Technischer Status:** `signed` bedeutet, dass alle erforderlichen Canvas-Unterschriften gesammelt und in das Artifact gestempelt wurden. Die Operator:in kann das Artifact zur BA hochladen. Die BA und relevante Behörden validieren die rechtliche Gültigkeit.

### Signed Artifact: Unterschrift-Stempel + Audit-Zertifikat

Quelle: `src/modules/documents/generate.ts` → `generateSignedArtifact()`

**Produkt:** PDF mit:
1. **Unterschriften-Stempel** auf der letzte Inhaltsseite (Footer-Band):
   - Gezogene Unterschrift (PNG, skaliert)
   - Label + Name + Zeitstempel pro Signer
2. **Audit-Zertifikat-Seite** (neu angehängt):
   - Überschrift: „Unterschriften-Nachweis" (Audit Certificate)
   - Dokumentinfo: Titel, SHA-256 des Original-Contents (was signiert wurde)
   - Pro Signer: Name, Signaturzeit, IP-Adresse, Verfahren (Canvas/QES/etc.), Bild
   - **Rechtlicher Status (wie im Code):** „Einfache elektronische Signatur (eIDAS SES) — PLATZHALTER, rechtliche Prüfung ausstehend"

**Wichtig:** Das Artifact ist ein **technischer Nachweis**, dass Unterschriften gesammelt und gestempelt wurden. Der Audit-Certificate beweist NICHT eIDAS-Compliance – das ist **ausstehend** und bedarf rechtlicher Überprüfung. Die Canvas-Signatur selbst ist eine **Simple Electronic Signature (SES)**, deren rechtliche Gültigkeit auf dem Deployment abhängt.

**Operatornote:** Das signierte Artifact wird automatisch generiert. Die Operator:in kann es downloaden und zur BA hochladen (zur Antragstellung). Die BA und relevante Behörden müssen die Rechtsgültigkeit bestätigen.

**Status-Label:** Technisch implementiert (Canvas + Audit), rechtliche Validierung ausstehend

---

## 3.3 Anträge: Status, Readiness, Submission

Quelle: `src/modules/applications/service.ts`, `src/db/schema/applications.ts`

### Application-Status-Maschine

```sql
in_preparation ──complete──→ complete ──submit──→ submitted ──(BA Response)──→ approved
        ↑                         ↑                                             | / rejected
        └─────────────────────────┴── correction_required (BA sagt: Fehler)────┘
```

**Terminal-Status:** `approved`, `rejected`

```typescript
export enum ApplicationStatus {
  in_preparation,      // Arbeitet noch an Dokumenten/Signaturen
  complete,            // Alle Readiness-Blockers gelöst, bereit zum Einreichen
  sent_to_employer,    // (optional) Arbeitgeber hat Antrag zur Prüfung erhalten
  submitted,           // Zu BA eService hochgeladen
  response_pending,    // Wartet auf BA-Antwort (in MVP = "submitted")
  approved,            // BA hat bewilligt
  rejected,            // BA hat abgelehnt
  correction_required, // BA sagt: Korrektionen nötig → zurück zu in_preparation
}
```

### Readiness-Blockers: Submission-Gating

Zentral definiert in `src/modules/documents/data.ts` → `evaluateApplicationReadiness()`

**Diese Blockers müssen gelöst sein, bevor `complete` oder `submitted` erlaubt ist:**

1. **`missing_participant`** – Teilnehmer:in-Datensätze unvollständig
   - Erforderlich: firstName, lastName, phone, email, street, postalCode, city, dateOfBirth, employmentStatus
   
2. **`missing_employer`** – Arbeitgeber:in-Daten unvollständig (wenn relevant)
   - Erforderlich: companyName, betriebsnummer, street, postalCode, city, contactName, contactEmail, contactPhone
   - AG-S Bestätigung: `agsRegistered` (true/false gültig), `timeModelStatus` (20h/Woche bestätigt)

3. **`missing_privacy_consent`** – Datenschutzerklärung nicht akzeptiert
   - Erforderlich: mindestens eine `consents` Zeile mit `kind: privacy_policy`

4. **`missing_measure`** – Maßnahme nicht verlinkt oder unvollständig
   - Erforderlich: Gültige Maßnahme mit startDate

5. **`upload_set_incomplete`** – Erforderliche Upload-Dokumente fehlen oder haben nicht-ready Status
   - Einzelantrag: `traegerbescheinigung`, `arbeitnehmererklaerung`, `fragebogen` → Status `prefilled` oder besser
   - Sammelantrag: `teilnehmerliste`, `eservice_company` → Status `prefilled` oder besser

6. **`form_signatures_ses`** – Erforderliche Canvas-Unterschriften fehlen (technische Gate, nicht rechtliche Validierung)
   - Z. B. für Einzelantrag: `arbeitnehmererklaerung` UND `fragebogen` müssen beide den Status `signed` haben
   - Sammelantrag: `teilnehmerliste` braucht keine Signatur
   - **Hinweis:** Der Status `signed` bedeutet, dass Canvas-Unterschriften gesammelt und gestempelt wurden. Die rechtliche Gültigkeit obliegt dem Deployment und der BA-Validierung.

7. **`employer_not_confirmed`** – Arbeitgeber-Status nicht `confirmed` (nur bei Sammelantrag)
   - AG muss sich selbst setup (Magic Link) absolviert haben

**Typische Nachricht:** „Antrag kann nicht vervollständigt werden: fehlende Datenschutzerklärung, Arbeitnehmer-Erklärung nicht unterzeichnet"

### changeApplicationStatus()

```typescript
export async function changeApplicationStatus(tx, params: {
  applicationId: string;
  to: ApplicationStatus;
  actorKind: "internal_user" | "employer";
  actorUserId?: string;
  responseNote?: string;
}): Promise<void>
```

**Atomare Transitionlogik:**
1. Lade Application
2. Validiere, dass `current_status` → `to` im `ALLOWED`-Map erlaubt ist
3. Falls `to === "complete"` oder `to === "submitted"`:
   - Rufe `computeReadiness()` auf
   - Falls Blockers existieren → wirft `ApplicationNotReadyError`
4. **Atomare Prüfung + Update (WHERE Status pinned):**
   ```sql
   UPDATE applications
   SET status = ?, submitted_at = (if submitted, now(), else old), ...
   WHERE id = ? AND status = ?
   RETURNING id;
   ```
   - Falls Concurrent Update bereits geschehen → kein RETURNING → wirft Fehler
5. Audit + Routing-Transition

**Concurrency:** Last-write-loses (streng): Zweiter Operator gewinnt **nicht**, es wird ein Fehler geworfen

### computeReadiness()

```typescript
export async function computeReadiness(tx, params: {
  participantId: string;
}): Promise<{ ready: boolean; blockers: ReadinessBlocker[] }>
```

- Ruft `evaluateApplicationReadiness()` auf
- Maps Blocker-Codes zu Labels für Operator-Anzeige

**UI-Checklist:** Die Operator:in sieht eine Checklist mit genau denselben Blockers + Labels wie `computeReadiness()` liefert – eine Quelle der Wahrheit

### Approval-Workflow: BA-Antwort

**Wenn BA eine Antwort gibt (via Portal oder manuell eingegeben):**

```typescript
await changeApplicationStatus(tx, {
  applicationId,
  to: "approved" | "rejected" | "correction_required",
  actorKind: "internal_user",
  actorUserId: consultantId,
  responseNote: "BA-Schreiben eingescannt und verarbeitet…"
});
```

**Konsequenzen:**
- `approved`: Participant wird zu `enrolled`, Task closed
- `rejected`: Terminal, keine weiteren Übergänge
- `correction_required`: Zurück zu `in_preparation`, Operator:in kann Dokumente korrigieren

### Package-Export: Antrag-Paket zum Download

Quelle: `src/modules/applications/package.ts`, `/api/applications/{id}/package/download`

**Inhalt:**
- Alle erforderlichen Dokumente (Readiness-Upload-Set)
- Alle signierten Artifacts
- Metadaten (JSON): Teilnehmer:in, Arbeitgeber, Maßnahme, Signatur-Audit
- CSV-Export: Schritt-für-Schritt-Begleitblatt (welche eService-Felder woher)

**Operatornote:** Laden Sie das Paket herunter, dann treten Sie in die BA eService-Webseite ein und laden Sie Dokument-für-Dokument für jeden Schritt hoch (6 oder 7 Schritte je nach Antragsweg).

---

## 3.4 Beziehungen: Task, Token, Document, Signature, Application, Outbound Message

```
┌─────────────────────────────────────────────────────────────────┐
│ Task (z. B. collect_sv_number, sign_participant_form)           │
│ - Externe Owner (Participant oder Employer)                     │
│ - Status: open, in_progress, waiting, done, escalated, cancelled│
│ - Created by: Routing Engine (on participant/application status)│
└──────────────────────┬────────────────────────────────────────────┘
                       │
          ┌────────────┼────────────┬──────────────┐
          ↓            ↓            ↓              ↓
       Magic Link   Outbound Msg Document     Application
       (1 pro Task) (task_id FK) (context)    (references)
       
    ┌─────────────┐ ┌──────────────────┐ ┌─────────────┐
    │ Token Hash  │ │ Postausgang      │ │ doc.pdf     │
    │ SHA-256     │ │ pending_approval │ │ status: ...  │
    │ used_at     │ │ ↓ approve ↓      │ │             │
    │ expires_at  │ │ sending          │ │ ┌─────────┐ │
    └─────────────┘ │ sent             │ │ │Signature│ │
                    │ ↓ (webhook) ↓    │ │ │(pending)│ │
                    │ delivered        │ │ │→ signed │ │
                    │                  │ │ └─────────┘ │
                    │ (in message_     │ │ sign_      │
                    │  deliveries)     │ │ file_path  │
                    └──────────────────┘ └─────────────┘
                                               ↓
                                        ┌─────────────────┐
                                        │ Application     │
                                        │ (participantId) │
                                        │ Readiness Gate  │
                                        │ ↓ complete ↓    │
                                        │ → submitted     │
                                        └─────────────────┘
```

### Entity-Relationships

**Task ↔ Magic Link (1:Many, Tokens supersede)**
- Ein Task kann mehrere Magic Links haben
- Beim Neuausstellen werden alte Tokens widerrufen (superseded)
- Das Token enthält `taskId` + `scope` (Task-Type)

**Task ↔ Outbound Message (1:Many)**
- Mehrere Messages pro Task möglich (z. B. Initial + Reminder)
- Task hat `ownerKind` + `ownerId` (Participant/Employer)
- Message snapshot: `recipient_kind`, `recipient_id`, `recipient_phone/email`, Body, Variables (mit Link-Payload)

**Document ↔ Signatures (1:Many)**
- Ein Dokument kann mehrere Signaturen brauchen (Teilnehmer + Arbeitgeber)
- Signature speichert `signer_kind` (Participant/Employer) + `signer_id`

**Application ↔ Documents (1:Many)**
- Ein Antrag referenziert sein Upload-Set (Readiness-Dokumente)
- Beispiel: Einzelantrag braucht [traegerbescheinigung, arbeitnehmererklaerung, fragebogen] alle signiert

**Application ↔ Tasks (Implicit via Routing)**
- Routing Engine triggered Tasks auf Application-Status-Änderungen
- Beispiel: `application.status === "submitted"` → Task `verify_ba_response` erstellt

---

## 3.5 Fehlerbehandlung und Operatoren-Troubleshooting

### Document Generation fehlgeschlagen

**Symptom:** Dokument-Status bleibt `data_missing`, keine PDF

**Ursachen:**
- Prerequisite fehlt (z. B. `measure.startDate` für `traegerbescheinigung`)
- Data incomplete: PDF-Generator wirft Exception bei leeren erforderlichen Feldern
- S3/Local Storage nicht zugänglich

**Troubleshooting:**
1. Prüfe Readiness-Blockers: `computeReadiness()` → welche Label?
2. Lade die Participant-Details: Alle erforderlichen Felder gesetzt?
3. Speicher-Logs: Könnte S3 / Local Dir zu voll/unzugänglich sein?
4. Versuche erneut: Button „Dokument regenerieren" auf der Dokument-Seite

### Signatur bleibt in `pending`

**Symptom:** Signature `status: pending`, aber Task ist `done`

**Ursachen:**
- Teilnehmer:in hat den Magic Link nicht geöffnet
- Token ist abgelaufen oder widerrufen
- TTL (`MAGIC_LINK_TTL_HOURS`) zu kurz

**Troubleshooting:**
1. Prüfe Token-Status: UI → Task Detail → Link-Status
2. Falls `revoked`: Widerruf, neuen Link ausstellen
3. Falls abgelaufen: Task ist noch `open`? → Link wird neuausgestellt
4. Resend: Wähle Signer → „Signatur erneut anfragen" → neuer Magic Link + Message

### Antrag bleibt in `in_preparation`

**Symptom:** `complete`-Button ist disabled, Readiness-Blockers zeigen

**Ursachen (nach Label, siehe 3.3):**
- **`missing_participant`**: Felder unvollständig
- **`missing_employer`**: Arbeitgeber Daten unvollständig
- **`upload_set_incomplete`**: Erforderliche Dokumente nicht `prefilled`
- **`form_signatures_ses`**: Erforderliche Signaturen nicht `signed`

**Troubleshooting:**
1. Gehe jede Label durch, erfülle sie nacheinander
2. Für Missing Data: Bearbeite Participant/Employer/Measure
3. Für Dokumente: Generiere auf der Dokumente-Seite
4. Für Signaturen: Stelle Magic Links aus, schicke Operatoren-Messages

---

## 3.6 Konfiguration: Storage, Secrets

```bash
# Speicher
STORAGE_DRIVER=local|s3
S3_BUCKET=my-bucket
S3_REGION=eu-central-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...

# Token-TTL
MAGIC_LINK_TTL_HOURS=168   # 7 Tage (default)

# Dokument-Träger (BA-Formular Header)
PROVIDER_NAME="codeKessel Inh. Ugur Karatas"
PROVIDER_CITY="Böblingen"
```

---

# 4. Operatoren-Schnellstart und Checklisten

## Workflow 1: Teilnehmer-Onboarding (Einzelantrag)

1. [Step] Importiere oder erstelle Participant (Name, Phone, Email, Address)
2. [Step] Verlinke mit Employer + Measure
3. [Step] Task `provide_sv_number` wird auto-erstellt → Magic Link
4. [Step] Approve Message in Postausgang, sendet Link via WhatsApp/Email
5. [Step] Participant öffnet Link, trägt SV-Nummer ein, Task completed
6. [Step] Nächster Task: `sign_documents` – System generiert Dokumente
7. [Step] Approve Messages für Signaturen
8. [Step] Participant signiert Canvas, Signatures werden `signed`
9. [Step] Application kann zu `complete` → `submitted` wechseln
10. [Step] Warte auf BA-Antwort, aktualisiere auf `approved` oder `rejected`

## Workflow 2: Problem-Operator-Actions

### Nachricht versenden fehlt oder ist fehlerhaft
1. Öffne `/outbox`
2. Finde die Nachricht (ggf. storniert, abgelehnt)
3. Falls noch `pending_approval`: Approve/Reject/Cancel
4. Falls Mission: Task-Seite → Button „Nachricht erneut senden" (generiert neue pending-Zeile)

### Link ist abgelaufen
1. Task-Seite → Link-Status: `revoked` oder `none`
2. Klicke „Link erneuern"
3. System widerruft alte, erstellt neuen, sendet via Message
4. Falls Task noch nicht done: Alte Links sind automatisch dead

### Dokument-Generation ist fehlgeschlagen
1. Dokument-Liste → Status `data_missing`
2. Klicke Regenerieren
3. Prüfe Readiness-Errors (Checkliste)
4. Fülle fehlende Daten + retry

### Antrag kann nicht eingereicht werden
1. Application-Seite → Readiness-Blockers anzeigen
2. Gehe Blockers durch (Upload-Set, Signaturen, Daten)
3. Erfülle einen nach dem anderen
4. `complete`-Button wird aktiviert

---

# 5. Zusammenfassung und Referenzen

| Bereich | Modul | Hauptdatei |
|---------|-------|-----------|
| **Messaging** | `messaging/` | `outbox.ts`, `adapters.ts` |
| **Postausgang** | `outbox/` | `actions.ts` |
| **Magic Links** | `tokens/` | `service.ts`, `policy.ts` |
| **Dokumente** | `documents/` | `actions.ts`, `generate.ts` |
| **Signaturen** | `signatures/` | `finalize.ts`, `requirements.ts` |
| **Anträge** | `applications/` | `service.ts`, `package.ts` |
| **Storage** | `storage/` | `index.ts`, `local-driver.ts`, `s3-driver.ts` |
| **Webhooks** | `messaging/` | `whatsapp-webhook.ts`, `deliveries.ts` |
| **Schema** | `db/schema/` | `outbound-messages.ts`, `documents.ts`, `signatures.ts`, `applications.ts` |

---

**Ende des Kapitels 3 — Kommunikation, Dokumente und Anträge**  
Letzter Update: 28. Juli 2026
