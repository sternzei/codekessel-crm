CREATE TYPE "public"."actor_kind" AS ENUM('system', 'internal_user', 'participant', 'employer');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('in_preparation', 'complete', 'sent_to_employer', 'submitted', 'response_pending', 'approved', 'rejected', 'correction_required');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'reminder_sent', 'no_show', 'completed', 'rescheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."appointment_type" AS ENUM('follow_up', 'aptitude_test', 'consultation');--> statement-breakpoint
CREATE TYPE "public"."aptitude_test_status" AS ENUM('invited', 'started', 'completed', 'passed', 'failed', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."availability_status" AS ENUM('yes', 'probably_employer_pending', 'partial', 'not_possible', 'unclear');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('internal', 'email', 'whatsapp', 'magic_link');--> statement-breakpoint
CREATE TYPE "public"."consent_kind" AS ENUM('privacy_policy', 'contact_consent', 'whatsapp_optin', 'data_processing');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('data_missing', 'prefilled', 'reviewed', 'approved', 'sent', 'submitted', 'signed');--> statement-breakpoint
CREATE TYPE "public"."employer_status" AS ENUM('new', 'invited', 'setup_in_progress', 'betriebsnummer_missing', 'ags_unclear', 'time_model_pending', 'confirmed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."employment_status" AS ENUM('employed', 'self_employed', 'unemployed', 'other');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('participant', 'employer', 'appointment', 'aptitude_test', 'task', 'document', 'signature', 'application');--> statement-breakpoint
CREATE TYPE "public"."measure_format" AS ENUM('full_time', 'part_time', 'online', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."owner_kind" AS ENUM('internal_user', 'participant', 'employer');--> statement-breakpoint
CREATE TYPE "public"."participant_status" AS ENUM('new', 'called', 'not_reachable', 'wrong_number', 'interested', 'not_interested', 'eligibility_unclear', 'employer_pending', 'qualified', 'test_phase', 'documents_phase', 'application_phase', 'enrolled', 'lost');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('scheduled', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."signature_status" AS ENUM('pending', 'signed', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'waiting', 'done', 'escalated', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('consultant', 'admin');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'consultant' NOT NULL,
	"password_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"azav_number" text,
	"duration_weeks" integer NOT NULL,
	"weekly_hours" integer DEFAULT 20 NOT NULL,
	"format" "measure_format" DEFAULT 'online' NOT NULL,
	"cost_eur" numeric(10, 2),
	"start_date" date,
	"target_group" text,
	"objective" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "employer_status" DEFAULT 'new' NOT NULL,
	"company_name" text NOT NULL,
	"street" text,
	"postal_code" text,
	"city" text,
	"industry" text,
	"employee_count" integer,
	"contact_name" text,
	"contact_role" text,
	"contact_email" text,
	"contact_phone" text,
	"betriebsnummer" text,
	"responsible_agency" text,
	"ags_registered" boolean,
	"ags_contact_name" text,
	"ags_contact_email" text,
	"ags_contact_phone" text,
	"training_support_confirmed" boolean,
	"time_model_status" "availability_status" DEFAULT 'unclear' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "participant_status" DEFAULT 'new' NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"date_of_birth" date,
	"street" text,
	"postal_code" text,
	"city" text,
	"employment_status" "employment_status",
	"availability_status" "availability_status" DEFAULT 'unclear' NOT NULL,
	"eligibility_notes" text,
	"source" text,
	"employer_id" uuid,
	"measure_id" uuid,
	"assigned_consultant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"consultant_id" uuid,
	"type" "appointment_type" DEFAULT 'follow_up' NOT NULL,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aptitude_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"status" "aptitude_test_status" DEFAULT 'invited' NOT NULL,
	"test_url" text,
	"invited_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger_entity" "entity_kind" NOT NULL,
	"trigger_status" text NOT NULL,
	"task_type" text NOT NULL,
	"title_template" text NOT NULL,
	"owner_kind" "owner_kind" NOT NULL,
	"channel" "channel" NOT NULL,
	"due_hours" integer,
	"reminder_plan" jsonb,
	"escalation_hours" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"owner_kind" "owner_kind" NOT NULL,
	"owner_user_id" uuid,
	"owner_participant_id" uuid,
	"owner_employer_id" uuid,
	"channel" "channel" DEFAULT 'internal' NOT NULL,
	"subject_kind" "entity_kind",
	"subject_id" uuid,
	"routing_rule_id" uuid,
	"due_at" timestamp with time zone,
	"escalation_at" timestamp with time zone,
	"escalated_to_user_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"subject_kind" "owner_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"employer_id" uuid,
	"measure_id" uuid,
	"status" "application_status" DEFAULT 'in_preparation' NOT NULL,
	"submitted_at" timestamp with time zone,
	"response_at" timestamp with time zone,
	"response_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"status" "document_status" DEFAULT 'data_missing' NOT NULL,
	"participant_id" uuid,
	"employer_id" uuid,
	"application_id" uuid,
	"template_key" text,
	"file_path" text,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "signature_status" DEFAULT 'pending' NOT NULL,
	"signer_kind" "owner_kind" NOT NULL,
	"signer_participant_id" uuid,
	"signer_employer_id" uuid,
	"signer_user_id" uuid,
	"signer_name" text,
	"signed_at" timestamp with time zone,
	"ip_address" text,
	"document_sha256" text,
	"provider" text DEFAULT 'canvas' NOT NULL,
	"signature_image_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"template_key" text,
	"fire_at" timestamp with time zone NOT NULL,
	"status" "reminder_status" DEFAULT 'scheduled' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"participant_id" uuid,
	"employer_id" uuid,
	"kind" "consent_kind" NOT NULL,
	"granted" boolean NOT NULL,
	"text_version" text NOT NULL,
	"ip_address" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_user_id" uuid,
	"subject_kind" "entity_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"event" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"channel" "channel" NOT NULL,
	"locale" text DEFAULT 'de' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measures" ADD CONSTRAINT "measures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employers" ADD CONSTRAINT "employers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_measure_id_measures_id_fk" FOREIGN KEY ("measure_id") REFERENCES "public"."measures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_assigned_consultant_id_users_id_fk" FOREIGN KEY ("assigned_consultant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_consultant_id_users_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aptitude_tests" ADD CONSTRAINT "aptitude_tests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aptitude_tests" ADD CONSTRAINT "aptitude_tests_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_participant_id_participants_id_fk" FOREIGN KEY ("owner_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_employer_id_employers_id_fk" FOREIGN KEY ("owner_employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_routing_rule_id_routing_rules_id_fk" FOREIGN KEY ("routing_rule_id") REFERENCES "public"."routing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_escalated_to_user_id_users_id_fk" FOREIGN KEY ("escalated_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_measure_id_measures_id_fk" FOREIGN KEY ("measure_id") REFERENCES "public"."measures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signer_participant_id_participants_id_fk" FOREIGN KEY ("signer_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signer_employer_id_employers_id_fk" FOREIGN KEY ("signer_employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signer_user_id_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_jobs" ADD CONSTRAINT "reminder_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_jobs" ADD CONSTRAINT "reminder_jobs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_idx" ON "users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "participants_status_idx" ON "participants" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "tasks_owner_user_idx" ON "tasks" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "magic_link_tokens_hash_idx" ON "magic_link_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_task_idx" ON "magic_link_tokens" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "reminder_jobs_due_idx" ON "reminder_jobs" USING btree ("status","fire_at");--> statement-breakpoint
CREATE INDEX "activity_log_subject_idx" ON "activity_log" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_key_idx" ON "message_templates" USING btree ("tenant_id","key","channel");