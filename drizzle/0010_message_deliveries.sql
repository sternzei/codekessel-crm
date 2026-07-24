CREATE TABLE "message_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid,
	"channel" "channel" DEFAULT 'whatsapp' NOT NULL,
	"provider_message_id" text NOT NULL,
	"recipient_kind" "owner_kind" NOT NULL,
	"recipient_id" uuid NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"error_detail" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "whatsapp_window_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_deliveries_provider_msg_idx" ON "message_deliveries" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "message_deliveries_task_idx" ON "message_deliveries" USING btree ("tenant_id","task_id");--> statement-breakpoint
-- RLS for message_deliveries (grants inherited via ALTER DEFAULT PRIVILEGES in
-- 0001). The webhook reconciler runs on the OWNER connection (bypasses RLS, like
-- the reminder worker) because a signed Meta callback carries no tenant/session;
-- app-role access stays tenant-scoped.
ALTER TABLE message_deliveries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_deliveries FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);