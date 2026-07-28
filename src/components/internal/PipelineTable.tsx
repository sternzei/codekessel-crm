"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { assignLeads } from "@/modules/participants/actions-internal";
import type { ConsultantOption } from "@/modules/participants/pipeline";
import { getRoleLabel } from "@/modules/auth/authorization";
import type { AppRole } from "@/modules/auth/authorization";

export interface PipelineRowView {
  id: string;
  name: string;
  subtitle: string;
  statusLabel: string;
  statusTone: BadgeTone;
  consultantName: string | null;
  source: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  createdLabel: string;
  updatedLabel: string;
  nextActionLabel: string;
}

type BadgeTone = "ok" | "warn" | "danger" | "neutral";

export interface PipelineTableProps {
  rows: PipelineRowView[];
  consultants: ConsultantOption[];
  currentRole: AppRole;
  sort: string;
  dir: string;
}

interface SortableColumn {
  key: string;
  label: string;
}

const SORTABLE_COLUMNS: SortableColumn[] = [
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
  { key: "created", label: "Erstellt" },
  { key: "updated", label: "Aktualisiert" },
];

const toneClass: Record<BadgeTone, string> = {
  ok: "badge badge--ok",
  warn: "badge badge--warn",
  danger: "badge badge--danger",
  neutral: "badge",
};

export function PipelineTable({
  rows,
  consultants,
  currentRole,
  sort,
  dir,
}: PipelineTableProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const returnTo = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const sortHref = (key: string): string => {
    const params = new URLSearchParams(searchParams.toString());
    const nextDir = sort === key && dir === "asc" ? "desc" : "asc";
    params.set("sort", key);
    params.set("dir", nextDir);
    params.delete("page");
    return `${pathname}?${params.toString()}`;
  };

  const ariaSort = (key: string): "ascending" | "descending" | "none" => {
    if (sort !== key) return "none";
    return dir === "asc" ? "ascending" : "descending";
  };

  const allSelected = rows.length > 0 && selected.size === rows.length;

  const handleToggleAll = (): void => {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  };

  const handleToggleRow = (id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectedIds = [...selected];

  return (
    <div className="pipeline-table-wrap">
      {selectedIds.length > 0 ? (
        <form action={assignLeads} className="pipeline-bulk-bar">
          <span className="pipeline-bulk-count">
            {selectedIds.length} ausgewählt
          </span>
          {selectedIds.map((id) => (
            <input key={id} type="hidden" name="participantId" value={id} />
          ))}
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="reports-field">
            <span className="sr-only">Beratung zuweisen</span>
            <select name="consultant" defaultValue="" aria-label="Beratung zuweisen">
              <option value="" disabled>
                Zuweisen an …
              </option>
              {currentRole !== "consultant" ? (
                <option value="unassigned">Zuweisung entfernen</option>
              ) : null}
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
          <button type="submit" className="button button--sm">
            Übernehmen
          </button>
          <button
            type="button"
            className="button button--sm button--ghost"
            onClick={() => setSelected(new Set())}
          >
            Auswahl aufheben
          </button>
        </form>
      ) : null}

      <table className="pipeline-table">
        <thead>
          <tr>
            <th className="pipeline-col-check">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={handleToggleAll}
                aria-label="Alle auf dieser Seite auswählen"
              />
            </th>
            {SORTABLE_COLUMNS.map((column) => (
              <th key={column.key} aria-sort={ariaSort(column.key)}>
                <Link href={sortHref(column.key)} className="pipeline-sort">
                  {column.label}
                  {sort === column.key ? (
                    <span aria-hidden="true">{dir === "asc" ? " ▲" : " ▼"}</span>
                  ) : null}
                </Link>
              </th>
            ))}
            <th>Beratung</th>
            <th>Quelle</th>
            <th>Kontakt</th>
            <th>Nächste Aktion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-selected={selected.has(row.id)}>
              <td className="pipeline-col-check">
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => handleToggleRow(row.id)}
                  aria-label={`${row.name} auswählen`}
                />
              </td>
              <td>
                <Link href={`/leads/${row.id}`} className="pipeline-lead-link">
                  {row.name}
                </Link>
                <div className="pipeline-lead-sub">{row.subtitle}</div>
              </td>
              <td>
                <span className={toneClass[row.statusTone]}>{row.statusLabel}</span>
              </td>
              <td>{row.createdLabel}</td>
              <td>{row.updatedLabel}</td>
              <td>{row.consultantName ?? "— nicht zugewiesen"}</td>
              <td>{row.source ?? "—"}</td>
              <td>
                <span
                  className="pipeline-contact"
                  data-ok={row.hasPhone}
                  title={row.hasPhone ? "Telefon vorhanden" : "Telefon fehlt"}
                >
                  {row.hasPhone ? "Tel ✓" : "Tel ✕"}
                </span>{" "}
                <span
                  className="pipeline-contact"
                  data-ok={row.hasEmail}
                  title={row.hasEmail ? "E-Mail vorhanden" : "E-Mail fehlt"}
                >
                  {row.hasEmail ? "Mail ✓" : "Mail ✕"}
                </span>
              </td>
              <td className="pipeline-next-action">{row.nextActionLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
