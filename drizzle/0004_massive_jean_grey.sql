ALTER TYPE "public"."document_status" ADD VALUE 'partially_signed' BEFORE 'signed';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "signed_file_path" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "signed_sha256" text;