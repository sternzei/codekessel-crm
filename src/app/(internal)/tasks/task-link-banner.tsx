"use client";

import { useEffect, useState } from "react";

type TaskLinkBannerProps = {
  readonly link: string;
};

type CopyState = "idle" | "copied" | "failed";

/**
 * After "Link erzeugen": show the magic link and auto-copy it. WhatsApp send
 * stays a separate one-click action on the task row — not a second step here.
 */
export const TaskLinkBanner = ({ link }: TaskLinkBannerProps) => {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
    }
  };

  useEffect(() => {
    let isActive = true;
    const copyOnMount = async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(link);
        if (!isActive) return;
        setCopyState("copied");
        window.setTimeout(() => {
          if (isActive) setCopyState("idle");
        }, 2000);
      } catch {
        if (isActive) setCopyState("failed");
      }
    };
    void copyOnMount();
    return () => {
      isActive = false;
    };
  }, [link]);

  return (
    <div className="card task-link-banner" style={{ marginBottom: "var(--space-6)" }}>
      <p
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          marginBottom: "var(--space-2)",
        }}
      >
        Aufgaben-Link erstellt
        {copyState === "copied" ? " · in Zwischenablage kopiert" : ""}
      </p>
      <code
        data-testid="task-link"
        style={{
          fontSize: "var(--text-xs)",
          wordBreak: "break-all",
          display: "block",
          marginBottom: "var(--space-3)",
        }}
      >
        {link}
      </code>
      <div className="task-link-actions">
        <button
          type="button"
          className="button button--sm"
          onClick={() => {
            void handleCopy();
          }}
          aria-label="Link in die Zwischenablage kopieren"
        >
          {copyState === "copied" ? "Kopiert" : "Link kopieren"}
        </button>
      </div>
      {copyState === "failed" ? (
        <p className="meta" role="alert" style={{ marginTop: "var(--space-2)" }}>
          Automatisches Kopieren fehlgeschlagen — bitte Link manuell markieren
          oder „Link kopieren“ nutzen.
        </p>
      ) : null}
    </div>
  );
};
