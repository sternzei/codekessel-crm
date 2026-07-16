"use client";

import { useEffect, useRef } from "react";
import SignaturePad from "signature_pad";

/**
 * Canvas signature field. Writes the PNG data URL into a hidden input on
 * every stroke so a plain <form action={serverAction}> submits it — no
 * client-side submission logic needed.
 */
export function SignaturePadField({ inputName }: { inputName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const padRef = useRef<SignaturePad | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d")?.scale(ratio, ratio);

    const pad = new SignaturePad(canvas, { penColor: "#1a2340" });
    padRef.current = pad;
    const sync = () => {
      if (inputRef.current) {
        inputRef.current.value = pad.isEmpty() ? "" : pad.toDataURL("image/png");
      }
    };
    pad.addEventListener("endStroke", sync);
    return () => {
      pad.removeEventListener("endStroke", sync);
      pad.off();
    };
  }, []);

  const clear = () => {
    padRef.current?.clear();
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <canvas
        ref={canvasRef}
        className="signature-canvas"
        aria-label="Unterschriftenfeld"
      />
      <input ref={inputRef} type="hidden" name={inputName} required />
      <button
        type="button"
        onClick={clear}
        className="button button--sm button--ghost"
        style={{ alignSelf: "flex-start" }}
      >
        Feld leeren
      </button>
    </div>
  );
}
