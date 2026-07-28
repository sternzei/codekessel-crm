import Link from "next/link";

type HelpLinkProps = {
  readonly topic: string;
  readonly label?: string;
};

/** Contextual entry into the curated in-app help center. */
export const HelpLink = ({
  topic,
  label = "Hilfe zu diesem Bereich",
}: HelpLinkProps) => (
  <Link
    href={`/hilfe?topic=${encodeURIComponent(topic)}`}
    className="help-inline-link"
    aria-label={label}
  >
    {label}
  </Link>
);
