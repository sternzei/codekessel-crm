import type { Metadata } from "next";
import { getLegalProvider } from "@/modules/legal/provider";

export const metadata: Metadata = {
  title: "Impressum",
  robots: { index: false, follow: false },
};

export default function ImpressumPage() {
  const provider = getLegalProvider();

  return (
    <>
      <h1>Impressum</h1>
      <p className="legal-lead">Angaben gemäß § 5 DDG</p>

      {!provider.isComplete ? (
        <p className="form-error" role="alert">
          Die Anbieterangaben sind in dieser Umgebung nicht hinterlegt
          (LEGAL_PROVIDER_*). In der Produktivumgebung startet die Anwendung ohne
          diese Angaben nicht.
        </p>
      ) : null}

      <section>
        <h2>Anbieter</h2>
        <p>
          {provider.name ?? "—"}
          {provider.addressLines.map((line) => (
            <span key={line}>
              <br />
              {line}
            </span>
          ))}
        </p>
      </section>

      {provider.representative ? (
        <section>
          <h2>Vertreten durch</h2>
          <p>{provider.representative}</p>
        </section>
      ) : null}

      <section>
        <h2>Kontakt</h2>
        <p>
          E-Mail:{" "}
          {provider.email ? (
            <a href={`mailto:${provider.email}`}>{provider.email}</a>
          ) : (
            "—"
          )}
          {provider.phone ? (
            <>
              <br />
              Telefon: {provider.phone}
            </>
          ) : null}
        </p>
      </section>

      {provider.registerEntry ? (
        <section>
          <h2>Registereintrag</h2>
          <p>{provider.registerEntry}</p>
        </section>
      ) : null}

      {provider.vatId ? (
        <section>
          <h2>Umsatzsteuer-Identifikationsnummer</h2>
          <p>{provider.vatId}</p>
        </section>
      ) : null}

      {provider.supervisoryAuthority ? (
        <section>
          <h2>Zuständige Aufsichtsbehörde</h2>
          <p>{provider.supervisoryAuthority}</p>
        </section>
      ) : null}

      <section>
        <h2>Streitbeilegung</h2>
        <p>
          Wir sind nicht bereit und nicht verpflichtet, an
          Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
          teilzunehmen.
        </p>
      </section>
    </>
  );
}
