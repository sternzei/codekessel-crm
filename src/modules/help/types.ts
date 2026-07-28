export type HelpRole = "consultant" | "manager" | "admin";

export type HelpCategory =
  | "routine"
  | "leads"
  | "messages"
  | "documents"
  | "appointments"
  | "admin";

export type HelpArticle = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: HelpCategory;
  readonly roles: readonly HelpRole[];
  readonly route: string;
  readonly steps: readonly string[];
  readonly outcome: string;
  readonly tips?: readonly string[];
  readonly keywords: readonly string[];
};
