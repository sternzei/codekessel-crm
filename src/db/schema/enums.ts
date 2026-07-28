import { pgEnum } from "drizzle-orm/pg-core";

// Every enum mirrors a status list from the product concept (README).
// Transitions on these enums are the events that drive the rules engine.

export const userRole = pgEnum("user_role", ["consultant", "admin"]);

export const participantStatus = pgEnum("participant_status", [
  "new",
  "called",
  "not_reachable",
  "wrong_number",
  "interested",
  "not_interested",
  "eligibility_unclear",
  "employer_pending",
  "qualified",
  "test_phase",
  "documents_phase",
  "application_phase",
  "enrolled",
  "lost",
]);

// The mandatory 20h/week × 6 months gate.
export const availabilityStatus = pgEnum("availability_status", [
  "yes",
  "probably_employer_pending",
  "partial",
  "not_possible",
  "unclear",
]);

export const employmentStatus = pgEnum("employment_status", [
  "employed",
  "self_employed",
  "unemployed",
  "other",
]);

export const employerStatus = pgEnum("employer_status", [
  "new",
  "invited",
  "setup_in_progress",
  "betriebsnummer_missing",
  "ags_unclear",
  "time_model_pending",
  "confirmed",
  "declined",
]);

export const appointmentStatus = pgEnum("appointment_status", [
  "scheduled",
  "reminder_sent",
  "no_show",
  "completed",
  "rescheduled",
  "cancelled",
]);

export const appointmentType = pgEnum("appointment_type", [
  "follow_up",
  "aptitude_test",
  "consultation",
]);

export const aptitudeTestStatus = pgEnum("aptitude_test_status", [
  "invited",
  "started",
  "completed",
  "passed",
  "failed",
  "no_show",
]);

export const taskStatus = pgEnum("task_status", [
  "open",
  "in_progress",
  "waiting",
  "done",
  "escalated",
  "cancelled",
]);

export const ownerKind = pgEnum("owner_kind", [
  "internal_user",
  "participant",
  "employer",
]);

export const channel = pgEnum("channel", [
  "internal",
  "email",
  "whatsapp",
  "magic_link",
]);

export const documentStatus = pgEnum("document_status", [
  "data_missing",
  "prefilled",
  "reviewed",
  "approved",
  "sent",
  "submitted",
  // At least one required signature collected, but not yet all of them.
  "partially_signed",
  "signed",
]);

export const signatureStatus = pgEnum("signature_status", [
  "pending",
  "signed",
  "declined",
  "expired",
]);

export const applicationStatus = pgEnum("application_status", [
  "in_preparation",
  "complete",
  "sent_to_employer",
  "submitted",
  "response_pending",
  "approved",
  "rejected",
  "correction_required",
]);

export const reminderStatus = pgEnum("reminder_status", [
  "scheduled",
  "sending",
  "sent",
  "failed",
  "cancelled",
]);

// Approval-before-send lifecycle for system-dispatched outbound messages.
// Nothing leaves the system until a signed-in user approves a pending row.
// pending_approval → approved → sending → sent → delivered / failed, plus the
// human decision branches rejected / cancelled. Kept as an enum (not free text)
// because the whole state machine keys on these exact values.
export const outboundMessageStatus = pgEnum("outbound_message_status", [
  "pending_approval",
  "approved",
  "sending",
  "sent",
  "delivered",
  "failed",
  "rejected",
  "cancelled",
]);

export const consentKind = pgEnum("consent_kind", [
  "privacy_policy",
  "contact_consent",
  "whatsapp_optin",
  "data_processing",
]);

// Polymorphic subject reference used by tasks, activity log, and routing rules.
export const entityKind = pgEnum("entity_kind", [
  "participant",
  "employer",
  "appointment",
  "aptitude_test",
  "task",
  "document",
  "signature",
  "application",
]);

export const actorKind = pgEnum("actor_kind", [
  "system",
  "internal_user",
  "participant",
  "employer",
]);

export const measureFormat = pgEnum("measure_format", [
  "full_time",
  "part_time",
  "online",
  "hybrid",
]);
