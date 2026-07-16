import { appointments } from "@/db/schema";
import {
  assertAvailabilityGate,
  type AvailabilityStatus,
} from "@/modules/participants/transitions";

type AppointmentType = (typeof appointments.type.enumValues)[number];

// Appointment types that put a participant into a post-qualification phase
// (the aptitude test). These require the SAME 20h/6-month availability
// confirmation as the gated status transitions — so we reuse that exact rule
// instead of re-encoding it. Early-funnel appointments (initial consultation,
// follow-up) are intentionally NOT gated: they happen before qualification.
const GATED_APPOINTMENT_TYPES: ReadonlySet<AppointmentType> = new Set([
  "aptitude_test",
]);

/**
 * Blocks scheduling a *gated* appointment (currently the aptitude test) unless
 * availability is a clear "yes". Non-gated appointment types are always
 * allowed. Throws {@link AvailabilityGateError} via the shared status gate.
 */
export function assertAppointmentAvailability(
  type: AppointmentType,
  availability: AvailabilityStatus,
): void {
  if (!GATED_APPOINTMENT_TYPES.has(type)) return;
  assertAvailabilityGate("test_phase", availability);
}

/**
 * Blocks inviting a participant to the aptitude test unless availability is a
 * clear "yes" — the aptitude test is the entry into the gated test phase.
 */
export function assertAptitudeInviteAvailability(
  availability: AvailabilityStatus,
): void {
  assertAvailabilityGate("test_phase", availability);
}
