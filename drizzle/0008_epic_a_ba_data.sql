ALTER TABLE "employers" ADD COLUMN "legal_form" text;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "iban" text;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "bic" text;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "staffing_by_hours_band" jsonb;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "salary_components" jsonb;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "has_betriebsvereinbarung" boolean;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "sv_number" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "iban" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "bic" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "monthly_gross_salary" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "salary_components" jsonb;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "weekly_working_hours" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "monthly_working_hours" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "schulungszeiten" jsonb;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "freistellungsstunden" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "qualification_history" jsonb;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "funding_status" jsonb;