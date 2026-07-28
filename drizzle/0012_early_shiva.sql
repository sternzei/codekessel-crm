CREATE TYPE "public"."outbound_message_status" AS ENUM('pending_approval', 'approved', 'sending', 'sent', 'delivered', 'failed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid,
	"channel" "channel" DEFAULT 'whatsapp' NOT NULL,
	"template_key" text NOT NULL,
	"recipient_kind" "owner_kind" NOT NULL,
	"recipient_id" uuid NOT NULL,
	"recipient_phone" text,
	"recipient_email" text,
	"recipient_name" text,
	"subject" text,
	"body" text NOT NULL,
	"variables" jsonb,
	"status" "outbound_message_status" DEFAULT 'pending_approval' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"rejected_by_user_id" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"provider_message_id" text,
	"error_detail" text,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_messages_status_idx" ON "outbound_messages" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "outbound_messages_task_idx" ON "outbound_messages" USING btree ("tenant_id","task_id");--> statement-breakpoint
-- RLS for outbound_messages (grants inherited via ALTER DEFAULT PRIVILEGES in
-- 0001). The reminder worker enqueues on the OWNER connection (bypasses RLS,
-- like message_deliveries); the approval server actions run tenant-scoped on the
-- qcg_app role, so app-role access stays isolated per tenant.
ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON outbound_messages FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);