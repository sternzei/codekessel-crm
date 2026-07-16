ALTER TABLE "employers" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "register_id" text;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "register_number" text;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "register_type" text;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "register_court" text;--> statement-breakpoint
CREATE UNIQUE INDEX "employers_tenant_register_idx" ON "employers" USING btree ("tenant_id","register_id");