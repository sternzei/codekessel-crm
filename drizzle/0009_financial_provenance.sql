ALTER TABLE "participants" ADD COLUMN "net_income" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "financial_year" integer;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "financials_source" text;