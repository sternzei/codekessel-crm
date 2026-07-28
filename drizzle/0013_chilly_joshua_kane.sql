ALTER TYPE "public"."user_role" ADD VALUE 'manager' BEFORE 'admin';--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_messages_creator_idx" ON "outbound_messages" USING btree ("tenant_id","created_by_user_id");