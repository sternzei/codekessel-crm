import { AccessibleDialog } from "@/components/ui/dialog";

export default function UiFoundationPage(): React.ReactNode {
  return (
    <section
      className="rounded-ck-md border border-ck-line bg-ck-surface p-6 text-ck-ink shadow-ck-card"
      aria-labelledby="ui-foundation-title"
    >
      <h1 id="ui-foundation-title" className="text-xl font-semibold">
        UI-Foundation Phase 0
      </h1>
      <p className="mt-2 max-w-prose text-sm text-ck-ink-soft">
        Diese interne Smoke-Fläche bestätigt die inkrementelle Tailwind- und
        Radix-Integration, ohne bestehende Produktionsseiten umzugestalten.
      </p>
      <AccessibleDialog
        title="Zugänglicher Dialog"
        description="Radix übernimmt Fokusführung, Escape und Rückgabe des Fokus."
        trigger={
          <button
            type="button"
            className="mt-6 min-h-11 rounded-ck-sm bg-ck-accent px-4 py-2 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ck-accent"
          >
            Dialog testen
          </button>
        }
      >
        <p className="text-sm">
          Der Dialog verwendet ausschließlich semantische CodeKessel-Token.
        </p>
      </AccessibleDialog>
    </section>
  );
}
