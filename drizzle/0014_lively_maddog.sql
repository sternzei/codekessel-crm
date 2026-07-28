ALTER TABLE "outbound_messages" DROP CONSTRAINT "outbound_messages_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;