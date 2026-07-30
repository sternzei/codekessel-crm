import type { Metadata } from "next";
import { getLegalProvider } from "@/modules/legal/provider";

export const metadata: Metadata = {
  title: "Datenschutzerklärung",
  robots: { index: false, follow: false },
};

export default function DatenschutzPage() {
  const provider = getLegalProvider();
  const controller = provider.name ?? "der Betreiber dieser Plattform";

  return (
    <>
      <h1>Datenschutzerklärung</h1>
      <p className="legal-lead">
        Informationen zur Verarbeitung Ihrer Daten nach Art. 13 DSGVO
      </p>

      {!provider.isComplete ? (
        <p className="form-error" role="alert">
          Die Angaben zum Verantwortlichen sind in dieser Umgebung nicht
          hinterlegt (LEGAL_PROVIDER_*). In der Produktivumgebung startet die
          Anwendung ohne diese Angaben nicht.
        </p>
      ) : null}

      <section>
        <h2>1. Verantwortlicher</h2>
        <p>
          {provider.name ?? "—"}
          {provider.addressLines.map((line) => (
            <span key={line}>
              <br />
              {line}
            </span>
          ))}
          {provider.email ? (
            <>
              <br />
              E-Mail: <a href={`mailto:${provider.email}`}>{provider.email}</a>
            </>
          ) : null}
          {provider.phone ? (
            <>
              <br />
              Telefon: {provider.phone}
            </>
          ) : null}
        </p>
      </section>

      {provider.privacyContact ? (
        <section>
          <h2>2. Datenschutzbeauftragte Stelle</h2>
          <p>{provider.privacyContact}</p>
        </section>
      ) : null}

      <section>
        <h2>3. Zweck der Verarbeitung</h2>
        <p>
          Wir verarbeiten Ihre Daten, um zu prüfen, ob eine geförderte
          Weiterbildung für Sie in Frage kommt, um den Förderantrag bei der
          Bundesagentur für Arbeit vorzubereiten und einzureichen und um Sie
          während des Verfahrens zu begleiten. Ohne diese Verarbeitung können
          wir keinen Antrag für Sie stellen.
        </p>
      </section>

      <section>
        <h2>4. Verarbeitete Daten</h2>
        <p>
          Je nach Stand des Verfahrens verarbeiten wir: Name, Anschrift,
          Geburtsdatum, Telefonnummer und E-Mail-Adresse, Angaben zu Ihrem
          Beschäftigungsverhältnis und Arbeitgeber, Ihre zeitliche Verfügbarkeit,
          Ergebnisse eines Eignungstests, Sozialversicherungsnummer,
          Bankverbindung, Angaben zu Gehalt und Arbeitszeit, die von Ihnen
          hochgeladenen Unterlagen sowie Ihre elektronische Unterschrift und den
          zugehörigen Zeitstempel.
        </p>
      </section>

      <section>
        <h2>5. Rechtsgrundlagen</h2>
        <p>
          Die Verarbeitung erfolgt zur Durchführung vorvertraglicher Maßnahmen
          und zur Erfüllung des Vertragsverhältnisses (Art. 6 Abs. 1 lit. b
          DSGVO), zur Erfüllung rechtlicher Verpflichtungen im
          Förderverfahren (Art. 6 Abs. 1 lit. c DSGVO) und — soweit Sie uns eine
          Einwilligung erteilt haben, etwa für die Kontaktaufnahme per WhatsApp —
          auf Grundlage Ihrer Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Eine
          erteilte Einwilligung können Sie jederzeit mit Wirkung für die Zukunft
          widerrufen.
        </p>
      </section>

      <section>
        <h2>6. Empfänger</h2>
        <p>
          Ihre Daten werden an die Bundesagentur für Arbeit übermittelt, soweit
          dies für den Förderantrag erforderlich ist, sowie — für die
          arbeitgeberbezogenen Angaben — an Ihren Arbeitgeber und an den
          Bildungsträger der Maßnahme. Daneben setzen wir Dienstleister ein, die
          ausschließlich weisungsgebunden für uns tätig sind
          (Auftragsverarbeitung nach Art. 28 DSGVO): den Betreiber unserer
          Server-Infrastruktur, unseren E-Mail-Versanddienst sowie — bei
          Kontaktaufnahme über WhatsApp — Meta Platforms Ireland Ltd. Bei der
          Nutzung von WhatsApp können Daten auch in die USA übermittelt werden;
          Grundlage sind die Standardvertragsklauseln der EU-Kommission. Wenn Sie
          das vermeiden möchten, nutzen Sie bitte E-Mail oder Telefon.
        </p>
      </section>

      <section>
        <h2>7. Speicherdauer</h2>
        <p>
          Wir speichern Ihre Daten, solange sie für die Bearbeitung Ihres
          Anliegens erforderlich sind, und darüber hinaus so lange, wie
          gesetzliche Aufbewahrungspflichten und Nachweispflichten gegenüber der
          Bundesagentur für Arbeit dies verlangen. Danach werden die Daten
          gelöscht.
        </p>
      </section>

      <section>
        <h2>8. Ihre Rechte</h2>
        <p>
          Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung
          (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung
          (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen die
          Verarbeitung (Art. 21). Wenden Sie sich dafür an die oben genannte
          Kontaktadresse. Unabhängig davon können Sie sich bei einer
          Datenschutz-Aufsichtsbehörde beschweren, in der Regel bei der Behörde
          Ihres Wohnorts.
        </p>
      </section>

      <section>
        <h2>9. Bereitstellungspflicht</h2>
        <p>
          Sie sind nicht verpflichtet, uns Ihre Daten zu überlassen. Ohne die für
          den Förderantrag erforderlichen Angaben kann {controller} den Antrag
          jedoch nicht stellen.
        </p>
      </section>

      <section>
        <h2>10. Aufgabenlinks und Cookies</h2>
        <p>
          Die Links, über die Sie zu einer Aufgabe gelangen, enthalten ein
          zeitlich begrenztes, personenbezogenes Zugangsmerkmal. Geben Sie den
          Link deshalb nicht weiter. Wir setzen keine Cookies zu Werbe- oder
          Analysezwecken ein; für angemeldete Mitarbeitende wird ausschließlich
          ein technisch notwendiges Sitzungs-Cookie verwendet.
        </p>
      </section>
    </>
  );
}
