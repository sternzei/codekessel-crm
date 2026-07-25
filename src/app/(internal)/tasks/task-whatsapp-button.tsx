"use client";

import { useState, useTransition } from "react";
import { buildWhatsAppClickToChat } from "@/modules/tasks/actions";

export type TaskWhatsAppLabels = {
  send: string;
  opening: string;
  opened: string;
  open: string;
  errors: {
    no_phone: string;
    not_applicable: string;
    failed: string;
  };
};

type Feedback =
  | { kind: "opened" }
  | { kind: "fallback"; url: string }
  | { kind: "error"; message: string }
  | null;

/**
 * Opens WhatsApp (Web on desktop, the app on mobile) with the task message
 * prefilled via a wa.me click-to-chat link, so the consultant sends it from
 * their own account. Calls the server action to build the link (which also
 * mints a fresh magic link for magic_link tasks), then window.open()s it. If
 * the popup is blocked we render an "In WhatsApp öffnen" link instead so the
 * draft is never lost.
 */
export function TaskWhatsAppButton({
  taskId,
  labels,
}: {
  taskId: string;
  labels: TaskWhatsAppLabels;
}) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  const handleClick = (): void => {
    setFeedback(null);
    startTransition(async () => {
      const result = await buildWhatsAppClickToChat(taskId);
      if (!result.ok) {
        setFeedback({ kind: "error", message: labels.errors[result.reason] });
        return;
      }
      // window.open returns null when a popup blocker refuses the tab; fall
      // back to a plain link the consultant can click directly.
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
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? labels.opening : labels.send}
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
}
