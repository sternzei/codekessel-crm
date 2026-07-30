import Image from "next/image";
import Link from "next/link";

/**
 * Shell for the two public legal pages. Deliberately branded: a participant
 * arrives here from a WhatsApp link and has to be able to tell at a glance who
 * is asking them for their data.
 */
export default function LegalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="legal-viewport">
      <header className="legal-masthead">
        <Image
          src="/brand/codekessel-wordmark.png"
          alt="CodeKessel"
          width={1024}
          height={298}
          className="legal-wordmark"
          unoptimized
        />
        <nav className="legal-nav" aria-label="Rechtliches">
          <Link href="/impressum">Impressum</Link>
          <Link href="/datenschutz">Datenschutz</Link>
        </nav>
      </header>
      <main className="legal-card">{children}</main>
    </div>
  );
}
