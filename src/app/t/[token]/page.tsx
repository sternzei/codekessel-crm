import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { withTenant } from "@/db/client";
import { documents, employers, participants, signatures } from "@/db/schema";
import { ConfirmAvailability } from "@/components/task-pages/participant/ConfirmAvailability";
import { ConfirmDetails } from "@/components/task-pages/participant/ConfirmDetails";
import { GiveConsent } from "@/components/task-pages/participant/GiveConsent";
import { RescheduleAppointment } from "@/components/task-pages/participant/RescheduleAppointment";
import { SignDocument } from "@/components/task-pages/participant/SignDocument";
import { StartAptitudeTest } from "@/components/task-pages/participant/StartAptitudeTest";
import { UploadDocuments } from "@/components/task-pages/participant/UploadDocuments";
import { ConfirmSubmission } from "@/components/task-pages/employer/ConfirmSubmission";
import { SetupAssistant } from "@/components/task-pages/employer/SetupAssistant";
import {
  loadTokenContext,
  verifyTokenSignature,
  type TokenValidation,
} from "@/modules/tokens/service";

export const dynamic = "force-dynamic";

const EMPLOYER_SETUP_SCOPES = new Set([
  "provide_betriebsnummer",
  "confirm_ags_status",
  "confirm_time_model",
  "employer_setup",
]);

type ParticipantRow = typeof participants.$inferSelect;
type EmployerRow = typeof employers.$inferSelect;

type PageData = {
  ctx: TokenValidation;
  participant: ParticipantRow | null;
  employer: EmployerRow | null;
  documentTitle: string | null;
};

// The single entry point for all external work: one link opens exactly one
// task. No login, no navigation, nothing else reachable from here.
export default async function TokenTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; saved?: string }>;
}) {
  const { token } = await params;
  const { done, saved } = await searchParams;
  const t = await getTranslations("taskPage");
  const rawToken = decodeURIComponent(token);

  const tokenSignature = await verifyTokenSignature(rawToken);
  if (!tokenSignature) {
    return <Message title={t("invalidTitle")} body={t("invalid")} />;
  }

  const data = await withTenant(
    tokenSignature.tenantId,
    async (tx): Promise<PageData> => {
      const ctx = await loadTokenContext(tx, rawToken);
      if (!ctx.ok) return { ctx, participant: null, employer: null, documentTitle: null };

      let participant: ParticipantRow | null = null;
      let employer: EmployerRow | null = null;
      let documentTitle: string | null = null;

      if (ctx.tokenRow.subjectKind === "participant") {
        const [p] = await tx
          .select()
          .from(participants)
          .where(eq(participants.id, ctx.tokenRow.subjectId));
        participant = p ?? null;
      } else {
        const [e] = await tx
          .select()
          .from(employers)
          .where(eq(employers.id, ctx.tokenRow.subjectId));
        employer = e ?? null;
      }

      if (
        ctx.tokenRow.scope === "sign_document" &&
        ctx.task.subjectKind === "signature" &&
        ctx.task.subjectId
      ) {
        const [sig] = await tx
          .select({ documentId: signatures.documentId })
          .from(signatures)
          .where(eq(signatures.id, ctx.task.subjectId));
        if (sig) {
          const [doc] = await tx
            .select({ title: documents.title })
            .from(documents)
            .where(eq(documents.id, sig.documentId));
          documentTitle = doc?.title ?? null;
        }
      }

      return { ctx, participant, employer, documentTitle };
    },
  );

  const { ctx } = data;

  // A just-completed task redirects here with ?done=1 — the token is now
  // "used", which for the completing person is a success, not an error.
  if (done === "1" && ((!ctx.ok && ctx.reason === "used") || ctx.ok)) {
    return <Message title={t("doneTitle")} body={t("doneBody")} success />;
  }

  if (!ctx.ok) {
    const body = {
      invalid: t("invalid"),
      expired: t("expired"),
      used: t("used"),
      revoked: t("revoked"),
      task_closed: t("taskClosed"),
    }[ctx.reason];
    return <Message title={t("invalidTitle")} body={body} />;
  }

  const firstName = data.participant?.firstName ?? "";
  const scope = ctx.tokenRow.scope;

  let content: React.ReactNode;
  if (scope === "confirm_availability") {
    content = <ConfirmAvailability token={rawToken} participantFirstName={firstName} />;
  } else if (scope === "start_aptitude_test") {
    content = <StartAptitudeTest token={rawToken} participantFirstName={firstName} />;
  } else if (
    (scope === "request_correct_contact" || scope === "confirm_reachability") &&
    data.participant
  ) {
    content = <ConfirmDetails token={rawToken} participant={data.participant} />;
  } else if (scope === "reschedule_after_no_show") {
    content = <RescheduleAppointment token={rawToken} participantFirstName={firstName} />;
  } else if (scope === "give_consent") {
    content = <GiveConsent token={rawToken} participantFirstName={firstName} />;
  } else if (scope === "upload_documents") {
    content = <UploadDocuments token={rawToken} participantFirstName={firstName} />;
  } else if (scope === "sign_document") {
    content = (
      <SignDocument
        token={rawToken}
        documentTitle={data.documentTitle ?? "Dokument"}
        signerDisplayName={
          data.participant
            ? `${data.participant.firstName} ${data.participant.lastName}`
            : (data.employer?.contactName ?? "")
        }
      />
    );
  } else if (scope === "confirm_submission" && data.employer) {
    content = (
      <ConfirmSubmission token={rawToken} companyName={data.employer.companyName} />
    );
  } else if (EMPLOYER_SETUP_SCOPES.has(scope) && data.employer) {
    content = (
      <SetupAssistant token={rawToken} employer={data.employer} saved={saved === "1"} />
    );
  } else {
    content = (
      <main className="task-card">
        <span className="kicker">Aufgabe</span>
        <h1>{ctx.task.title}</h1>
        <p className="intro">{t("placeholderNote")}</p>
      </main>
    );
  }

  return <div className="task-viewport">{content}</div>;
}

function Message({
  title,
  body,
  success = false,
}: {
  title: string;
  body: string;
  success?: boolean;
}) {
  return (
    <div className="task-viewport">
      <main className="task-card">
        <span className="kicker">{success ? "✓ Erledigt" : "Hinweis"}</span>
        <h1>{title}</h1>
        <p className="intro">{body}</p>
      </main>
    </div>
  );
}
