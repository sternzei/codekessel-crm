import Link from "next/link";

/**
 * Impressum + Datenschutz footnote. Required on every surface that asks a
 * private individual for data (§5 DDG, Art. 13 DSGVO) — participants reach the
 * token pages from a WhatsApp message, with no other way to see who is asking.
 */
export const LegalLinks = ({ note }: { readonly note?: string }) => (
  <footer className="legal-links">
    {note ? <span>{note}</span> : null}
    <Link href="/impressum">Impressum</Link>
    <Link href="/datenschutz">Datenschutz</Link>
  </footer>
);
