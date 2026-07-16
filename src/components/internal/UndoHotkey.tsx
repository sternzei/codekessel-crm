"use client";

import { useEffect, useRef } from "react";

/**
 * Renders the "Rückgängig" button for reverting the last action on a lead and
 * binds it to Ctrl/Cmd+Z. The heavy lifting is the server action passed in as
 * `action`; this component only wires the keyboard shortcut to submit it.
 *
 * The shortcut is *always* active so the console feels responsive: the server
 * action reverts the last status/availability change, or — when there is
 * nothing to undo — redirects with a "nothing to undo" notice. That is much
 * clearer than a silently-inert shortcut.
 *
 * Native undo inside form fields is left alone — the shortcut only fires when
 * focus is outside an input/textarea/select/contentEditable, so typing a note
 * and pressing Cmd+Z still undoes text, not the lead's status.
 */
export function UndoHotkey({
  action,
  participantId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  participantId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey) return;
      if (event.key !== "z" && event.key !== "Z") return;

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      formRef.current?.requestSubmit();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="participantId" value={participantId} />
      <button
        type="submit"
        className="button button--sm button--ghost"
        title="Letzte Aktion rückgängig machen (⌘/Strg + Z)"
      >
        ↶ Rückgängig
      </button>
    </form>
  );
}
