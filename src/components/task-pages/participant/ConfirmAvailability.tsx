import { getTranslations } from "next-intl/server";
import { confirmAvailability } from "@/modules/participants/actions";

const OPTIONS = [
  "yes",
  "probably_employer_pending",
  "partial",
  "not_possible",
  "unclear",
] as const;

export interface ConfirmAvailabilityProps {
  token: string;
  participantFirstName: string;
}

export async function ConfirmAvailability({
  token,
  participantFirstName,
}: ConfirmAvailabilityProps) {
  const t = await getTranslations("taskPage.availability");

  return (
    <main className="task-card">
      <span className="kicker">Geförderte Weiterbildung</span>
      <h1>{t("title")}</h1>
      <p className="intro">
        Hallo {participantFirstName}, {t("intro")}
      </p>
      <form action={confirmAvailability} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <input type="hidden" name="token" value={token} />
        <fieldset className="choice-group">
          <legend className="sr-only" style={{ position: "absolute", left: "-9999px" }}>
            {t("title")}
          </legend>
          {OPTIONS.map((value, index) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="availability"
                value={value}
                required
                defaultChecked={index === 0}
              />
              <span>{t(`options.${value}`)}</span>
            </label>
          ))}
        </fieldset>
        <button type="submit" className="button">
          {t("submit")}
        </button>
      </form>
    </main>
  );
}
