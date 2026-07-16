CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"criteria" jsonb,
	"stats" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"started_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "register_id" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "phone_normalized" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "import_run_id" uuid;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_tenant_register_idx" ON "participants" USING btree ("tenant_id","register_id") WHERE "participants"."register_id" is not null;--> statement-breakpoint
CREATE INDEX "participants_pipeline_idx" ON "participants" USING btree ("tenant_id","status","assigned_consultant_id","created_at");--> statement-breakpoint
CREATE INDEX "participants_source_idx" ON "participants" USING btree ("tenant_id","source");--> statement-breakpoint
CREATE INDEX "tasks_active_dedup_idx" ON "tasks" USING btree ("tenant_id","type","owner_kind",coalesce("owner_participant_id", "owner_employer_id", "owner_user_id"),"subject_kind","subject_id") WHERE "tasks"."status" in ('open', 'in_progress', 'waiting');--> statement-breakpoint
-- RLS for import_runs (grants inherited via ALTER DEFAULT PRIVILEGES in 0001).
ALTER TABLE import_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON import_runs FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);