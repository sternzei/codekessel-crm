import { boolean, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { availabilityStatus, employerStatus } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";

// The employer is the main bottleneck of the QCG process — this table tracks
// exactly the data the Arbeitsagentur needs plus the setup-assistant progress.
export const employers = pgTable("employers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  status: employerStatus("status").notNull().default("new"),

  companyName: text("company_name").notNull(),
  street: text("street"),
  postalCode: text("postal_code"),
  city: text("city"),
  industry: text("industry"),
  employeeCount: integer("employee_count"),

  contactName: text("contact_name"),
  contactRole: text("contact_role"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),

  // Betriebsnummer — hard requirement for the application.
  betriebsnummer: text("betriebsnummer"),

  // Arbeitgeberservice (AG-S) registration.
  responsibleAgency: text("responsible_agency"),
  agsRegistered: boolean("ags_registered"),
  agsContactName: text("ags_contact_name"),
  agsContactEmail: text("ags_contact_email"),
  agsContactPhone: text("ags_contact_phone"),

  // Confirmations from the setup assistant.
  trainingSupportConfirmed: boolean("training_support_confirmed"),
  timeModelStatus: availabilityStatus("time_model_status")
    .notNull()
    .default("unclear"),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
