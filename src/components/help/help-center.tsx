"use client";

import Link from "next/link";
import {
  useMemo,
  useState,
  useEffect,
  useRef,
  type ChangeEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  HELP_ARTICLES,
  HELP_CATEGORY_LABELS,
  HELP_ROLE_LABELS,
} from "@/modules/help/articles";
import type { HelpArticle, HelpCategory, HelpRole } from "@/modules/help/types";

type HelpCenterProps = {
  readonly viewerRole: HelpRole;
  readonly viewerName: string;
};

const ALL_CATEGORIES = Object.keys(HELP_CATEGORY_LABELS) as HelpCategory[];

const matchesQuery = (article: HelpArticle, query: string): boolean => {
  if (!query) return true;
  const haystack = [
    article.title,
    article.summary,
    article.outcome,
    article.route,
    ...article.steps,
    ...article.keywords,
    ...(article.tips ?? []),
    HELP_CATEGORY_LABELS[article.category],
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
};

export const HelpCenter = ({ viewerRole, viewerName }: HelpCenterProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const detailRef = useRef<HTMLElement | null>(null);
  const initialTopic = searchParams.get("topic") ?? "";
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<HelpRole | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<HelpCategory | "all">(
    "all",
  );
  const [activeId, setActiveId] = useState<string>(initialTopic);

  useEffect(() => {
    const topic = searchParams.get("topic");
    if (topic) setActiveId(topic);
  }, [searchParams]);

  const featured = useMemo(
    () => HELP_ARTICLES.filter((article) => article.roles.includes(viewerRole)),
    [viewerRole],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return HELP_ARTICLES.filter((article) => {
      const roleOk =
        roleFilter === "all" || article.roles.includes(roleFilter);
      const categoryOk =
        categoryFilter === "all" || article.category === categoryFilter;
      return roleOk && categoryOk && matchesQuery(article, normalized);
    });
  }, [query, roleFilter, categoryFilter]);

  const activeArticle =
    HELP_ARTICLES.find((article) => article.id === activeId) ?? filtered[0] ?? null;

  const handleSelectArticle = (articleId: string): void => {
    setActiveId(articleId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("topic", articleId);
    router.replace(`/hilfe?${params.toString()}`, { scroll: false });
    requestAnimationFrame(() => {
      detailRef.current?.focus();
    });
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setQuery(event.target.value);
  };

  const handleRoleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setRoleFilter(event.target.value as HelpRole | "all");
  };

  const handleCategoryChange = (
    event: ChangeEvent<HTMLSelectElement>,
  ): void => {
    setCategoryFilter(event.target.value as HelpCategory | "all");
  };

  const handleShowMyRole = (): void => {
    setRoleFilter(viewerRole);
    setCategoryFilter("all");
    setQuery("");
  };

  return (
    <div className="help-center">
      <section className="help-hero" aria-labelledby="help-title">
        <div className="help-hero-copy">
          <p className="help-eyebrow">In-App Hilfe</p>
          <h1 id="help-title">Wie möchten Sie weiterkommen?</h1>
          <p>
            Kuratierte Abläufe für den Alltag — gefiltert nach Rolle. Keine
            Engineering-Docs, nur was Berater:innen und Teamleitung brauchen.
          </p>
          <p className="help-viewer">
            Angemeldet als <strong>{viewerName}</strong> ·{" "}
            {HELP_ROLE_LABELS[viewerRole]}
          </p>
        </div>
        <div className="help-hero-panel">
          <label className="help-search-label" htmlFor="help-search">
            Hilfe durchsuchen
          </label>
          <input
            id="help-search"
            className="help-search"
            type="search"
            value={query}
            onChange={handleSearchChange}
            placeholder="z. B. Freigabe, Claim, Dokumente…"
            autoComplete="off"
          />
          <div className="help-filters">
            <label>
              Rolle
              <select
                value={roleFilter}
                onChange={handleRoleChange}
                aria-label="Nach Rolle filtern"
              >
                {(Object.keys(HELP_ROLE_LABELS) as Array<HelpRole | "all">).map(
                  (role) => (
                    <option key={role} value={role}>
                      {HELP_ROLE_LABELS[role]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Thema
              <select
                value={categoryFilter}
                onChange={handleCategoryChange}
                aria-label="Nach Thema filtern"
              >
                <option value="all">Alle Themen</option>
                {ALL_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {HELP_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="help-chip-btn"
              onClick={handleShowMyRole}
            >
              Für meine Rolle
            </button>
          </div>
        </div>
      </section>

      <section className="help-featured" aria-label="Empfohlen für Ihre Rolle">
        <div className="help-section-head">
          <h2>Für {HELP_ROLE_LABELS[viewerRole]}</h2>
          <span>{featured.length} empfohlene Abläufe</span>
        </div>
        <div className="help-featured-grid">
          {featured.slice(0, 4).map((article) => (
            <button
              key={article.id}
              type="button"
              className={
                activeArticle?.id === article.id
                  ? "help-feature-card is-active"
                  : "help-feature-card"
              }
              onClick={() => handleSelectArticle(article.id)}
              aria-pressed={activeArticle?.id === article.id}
            >
              <span className="help-cat">
                {HELP_CATEGORY_LABELS[article.category]}
              </span>
              <strong>{article.title}</strong>
              <span>{article.summary}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="help-workspace">
        <aside className="help-list" aria-label="Alle Hilfethemen">
          <div className="help-section-head">
            <h2>Themen</h2>
            <span>
              {filtered.length} / {HELP_ARTICLES.length}
            </span>
          </div>
          {filtered.length === 0 ? (
            <p className="help-empty">Keine Treffer — Filter zurücksetzen.</p>
          ) : (
            <ul>
              {filtered.map((article) => (
                <li key={article.id}>
                  <button
                    type="button"
                    className={
                      activeArticle?.id === article.id
                        ? "help-list-item is-active"
                        : "help-list-item"
                    }
                    onClick={() => handleSelectArticle(article.id)}
                    aria-current={
                      activeArticle?.id === article.id ? "true" : undefined
                    }
                  >
                    <span className="help-cat">
                      {HELP_CATEGORY_LABELS[article.category]}
                    </span>
                    <strong>{article.title}</strong>
                    <span className="help-list-summary">{article.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <article
          className="help-detail"
          ref={detailRef}
          tabIndex={-1}
          aria-live="polite"
        >
          {activeArticle ? (
            <>
              <header className="help-detail-head">
                <span className="help-cat">
                  {HELP_CATEGORY_LABELS[activeArticle.category]}
                </span>
                <h2>{activeArticle.title}</h2>
                <p>{activeArticle.summary}</p>
                <div className="help-role-row">
                  {activeArticle.roles.map((role) => (
                    <span key={role} className="help-role-pill">
                      {HELP_ROLE_LABELS[role]}
                    </span>
                  ))}
                </div>
              </header>

              <ol className="help-steps">
                {activeArticle.steps.map((step, index) => (
                  <li key={`${activeArticle.id}-${index}`}>
                    <span className="help-step-index" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>

              <div className="help-outcome">
                <strong>Ergebnis</strong>
                <p>{activeArticle.outcome}</p>
              </div>

              {activeArticle.tips && activeArticle.tips.length > 0 ? (
                <div className="help-tips">
                  <strong>Hinweise</strong>
                  <ul>
                    {activeArticle.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="help-detail-actions">
                <Link
                  href={activeArticle.route}
                  className="button"
                  aria-label={`Zur Seite ${activeArticle.route} wechseln`}
                >
                  In der App öffnen
                </Link>
                <code className="help-route">{activeArticle.route}</code>
              </div>
            </>
          ) : (
            <p className="help-empty">Bitte ein Thema auswählen.</p>
          )}
        </article>
      </div>
    </div>
  );
};
