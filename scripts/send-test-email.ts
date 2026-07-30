/**
 * Sends one real email through the production email adapter to prove the Resend
 * credentials, the sending domain and the payload shape all work end to end.
 * Nothing is written to the database — this only exercises the adapter.
 *
 *   pnpm email:test emre@attestria.com
 */
import { getAdapter, resolveAdapterMode } from "@/modules/messaging/adapters";

const recipientEmail = process.argv[2] ?? "emre@attestria.com";

async function main(): Promise<void> {
  if (resolveAdapterMode("email") !== "live") {
    throw new Error(
      "Email adapter is in mock mode — set RESEND_API_KEY and RESEND_FROM_EMAIL",
    );
  }

  const result = await getAdapter("email").send({
    tenantId: "smoke-test",
    channel: "email",
    templateKey: "smoke_test",
    recipient: {
      kind: "participant",
      id: "smoke-test",
      email: recipientEmail,
      displayName: "Emre",
    },
    subject: "Testmail: E-Mail-Versand ist eingerichtet",
    body: [
      "Hallo Emre,",
      "",
      "diese Nachricht wurde über den Resend-Adapter der Antragsplattform versendet.",
      "Wenn sie ankommt, funktionieren API-Key, Absenderdomain und Versandweg.",
      "",
      "Viele Grüße",
      "Ihr Beratungsteam",
    ].join("\n"),
  });

  if (!result.ok) throw new Error(`Send failed: ${result.error}`);
  console.log(`Sent to ${recipientEmail} from ${process.env.RESEND_FROM_EMAIL}`);
}

await main();
