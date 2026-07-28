"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { ConsultantOption } from "@/modules/participants/pipeline";
import { getRoleLabel } from "@/modules/auth/authorization";
import type {
  ParticipantStatus,
} from "@/modules/participants/queries";

export interface PipelineFiltersProps {
  statuses: readonly ParticipantStatus[];
  statusLabels: Record<string, string>;
  consultants: ConsultantOption[];
  sources: string[];
  current: {
    status: string[];
    consultant: string;
    source: string;
    createdFrom: string;
    createdUntil: string;
    phone: string;
    email: string;
    q: string;
    sort: string;
    dir: string;
  };
}

const PRESENCE_LABEL: Record<string, string> = {
  "": "Alle",
  with: "Vorhanden",
  without: "Fehlt",
};

export function PipelineFilters({
  statuses,
  statusLabels,
  consultants,
  sources,
  current,
}: PipelineFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState<boolean>(current.status.length > 0);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      const text = value.toString().trim();
      if (text) params.append(key, text);
    }
    // A filter change always returns to the first page; sorting is preserved.
    params.delete("page");
    if (current.sort && current.sort !== "created") params.set("sort", current.sort);
    if (current.dir && current.dir !== "desc") params.set("dir", current.dir);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const handleReset = (): void => {
    router.push(pathname);
  };

  const hasFilters =
    current.status.length > 0 ||
    Boolean(
      current.consultant ||
        current.source ||
        current.createdFrom ||
        current.createdUntil ||
        current.phone ||
        current.email ||
        current.q,
    );

  return (
    <form className="card pipeline-filters" onSubmit={handleSubmit}>
      <div className="pipeline-filters-row">
        <label className="reports-field pipeline-search">
          <span>Suche</span>
          <input
            type="search"
            name="q"
            defaultValue={current.q}
            placeholder="Name oder Ort"
            aria-label="Leads durchsuchen"
          />
        </label>
        <label className="reports-field">
          <span>Beratung</span>
          <select name="consultant" defaultValue={current.consultant}>
            <option value="">Alle</option>
            <option value="unassigned">Nicht zugewiesen</option>
            {consultants.map((consultant) => (
              <option key={consultant.id} value={consultant.id}>
                {consultant.name}
                {consultant.role === "consultant"
                  ? ""
                  : ` (${getRoleLabel(consultant.role)})`}
              </option>
            ))}
          </select>
        </label>
        <label className="reports-field">
          <span>Quelle</span>
          <select name="source" defaultValue={current.source}>
            <option value="">Alle</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
        <label className="reports-field">
          <span>Erstellt von</span>
          <input type="date" name="createdFrom" defaultValue={current.createdFrom} />
        </label>
        <label className="reports-field">
          <span>bis</span>
          <input type="date" name="createdUntil" defaultValue={current.createdUntil} />
        </label>
        <label className="reports-field">
          <span>Telefon</span>
          <select name="phone" defaultValue={current.phone}>
            {Object.entries(PRESENCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="reports-field">
          <span>E-Mail</span>
          <select name="email" defaultValue={current.email}>
            {Object.entries(PRESENCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <details
        className="pipeline-status-filter"
        open={open}
        onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary>
          Status
          {current.status.length > 0 ? (
            <span className="badge" style={{ marginLeft: "var(--space-2)" }}>
              {current.status.length}
            </span>
          ) : null}
        </summary>
        <div className="pipeline-status-grid">
          {statuses.map((status) => (
            <label key={status} className="pipeline-status-option">
              <input
                type="checkbox"
                name="status"
                value={status}
                defaultChecked={current.status.includes(status)}
              />
              <span>{statusLabels[status] ?? status}</span>
            </label>
          ))}
        </div>
      </details>

      <div className="pipeline-filters-actions">
        <button type="submit" className="button button--sm">
          Filter anwenden
        </button>
        {hasFilters ? (
          <button
            type="button"
            className="button button--sm button--ghost"
            onClick={handleReset}
          >
            Zurücksetzen
          </button>
        ) : null}
      </div>
    </form>
  );
}
