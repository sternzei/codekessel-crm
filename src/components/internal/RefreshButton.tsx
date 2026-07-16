"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRefresh = (): void => {
    startTransition(() => router.refresh());
  };

  return (
    <button
      type="button"
      className="button button--sm button--ghost"
      onClick={handleRefresh}
      aria-label="Daten aktualisieren"
    >
      {isPending ? "Aktualisiere …" : "Aktualisieren"}
    </button>
  );
}
