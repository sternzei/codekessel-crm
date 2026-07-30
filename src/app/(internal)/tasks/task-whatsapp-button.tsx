"use client";

import { useState, useTransition } from "react";
import {
  buildWhatsAppClickToChat,
  sendTaskWhatsApp,
} from "@/modules/tasks/actions";
import type { AdapterMode } from "@/modules/messaging/adapters";

export type TaskWhatsAppLabels = {
  send: string;
  opening: string;
  opened: string;
  open: string;
  errors: {
    no_phone: string;
    not_applicable: string;
    must_claim: string;
    forbidden: string;
    no_template: string;
    failed: string;
  };
};

type Feedback =
  | { kind: "opened" }
  | { kind: "fallback"; url: string }
  | { kind: "error"; message: string }
  | null;

/**
 * WhatsApp action on a task row.
 * - LIVE Cloud API: one-click send via Firmennummer.
 * - Mock (Meta not configured yet): opens wa.me draft on the consultant's own
 *   WhatsApp — never pretends a Cloud send succeeded.
 */
export const TaskWhatsAppButton = ({
  taskId,
  mode,
  labels,
}: {
  readonly taskId: string;
  readonly mode: AdapterMode;
  readonly labels: TaskWhatsAppLabels;
}) => {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  if (mode === "live") {
    return (
      <form action={sendTaskWhatsApp}>
        <input type="hidden" name="taskId" value={taskId} />
        <button
          type="submit"
          className="button button--sm button--ghost"
          aria-label="Nachricht über Firmen-WhatsApp senden"
        >
          {labels.send}
        </button>
      </form>
    );
  }

  const handleOpenWhatsApp = (): void => {
    setFeedback(null);
    startTransition(async () => {
      const result = await buildWhatsAppClickToChat(taskId);
      if (!result.ok) {
        setFeedback({ kind: "error", message: labels.errors[result.reason] });
        return;
      }
      const opened = window.open(result.url, "_blank", "noopener");
      setFeedback(
        opened ? { kind: "opened" } : { kind: "fallback", url: result.url },
      );
    });
  };

  if (feedback?.kind === "fallback") {
    return (
      <a
        className="button button--sm button--ghost"
        href={feedback.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {labels.open}
      </a>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "var(--space-1)",
      }}
    >
      <button
        type="button"
        className="button button--sm button--ghost"
        onClick={handleOpenWhatsApp}
        disabled={isPending}
        aria-label="WhatsApp mit vorbereitetem Text öffnen"
      >
        {isPending ? labels.opening : labels.open}
      </button>
      {feedback?.kind === "opened" ? (
        <span className="meta" role="status">
          {labels.opened}
        </span>
      ) : null}
      {feedback?.kind === "error" ? (
        <span className="meta" role="alert">
          {feedback.message}
        </span>
      ) : null}
    </span>
  );
};
