-- Idempotent guards: dev databases that applied these changes under the
-- superseded 0009_curious_arclight tag can replay this file safely; fresh
-- databases get the plain DDL.
ALTER TYPE "public"."reminder_status" ADD VALUE IF NOT EXISTS 'sending' BEFORE 'sent';--> statement-breakpoint
DROP INDEX IF EXISTS "tasks_active_dedup_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_active_dedup_idx" ON "tasks" USING btree ("tenant_id","type","owner_kind",coalesce("owner_participant_id", "owner_employer_id", "owner_user_id"),"subject_kind","subject_id") WHERE "tasks"."status" in ('open', 'in_progress', 'waiting');
