import { PIPELINE_STATUS_ORDER, type ParticipantStatus } from "./queries";

// Explicit legal-transition map for participant_status, mirroring the ALLOWED
// pattern in applications/service.ts. This is the single source of truth for
// which lead status changes are permitted; the availability gate
// (transitions.ts) is enforced *on top of* it.

// Contact-phase outcomes recorded during the initial call funnel. They are
// peers, not a sequence: a lead can be re-called, re-reached, or re-evaluated,
// so any of them may follow any other. Keeping them mutually reachable is what
// lets the call-script quick actions stay valid from every early state.
const EARLY_FUNNEL: readonly ParticipantStatus[] = [
  "new",
  "called",
  "not_reachable",
  "wrong_number",
  "interested",
  "not_interested",
  "eligibility_unclear",
];

// Linear post-qualification phase chain. Its ordering is NOT re-declared here —
// it is sliced out of PIPELINE_STATUS_ORDER so the funnel order lives in exactly
// one place (queries.ts / the enum).
const PHASE_CHAIN: readonly ParticipantStatus[] = PIPELINE_STATUS_ORDER.slice(
  PIPELINE_STATUS_ORDER.indexOf("qualified"),
  PIPELINE_STATUS_ORDER.indexOf("enrolled") + 1,
);

// Drop-out state reachable from every non-terminal status (the escape hatch).
const LOST: ParticipantStatus = "lost";

function buildAllowedMap(): Record<
  ParticipantStatus,
  ReadonlySet<ParticipantStatus>
> {
  const map = {} as Record<ParticipantStatus, Set<ParticipantStatus>>;
  for (const status of PIPELINE_STATUS_ORDER) map[status] = new Set();

  // Early funnel: any contact outcome → any other, plus entry into the
  // employer-check / qualification path.
  for (const from of EARLY_FUNNEL) {
    for (const to of EARLY_FUNNEL) {
      if (from !== to) map[from].add(to);
    }
    map[from].add("employer_pending");
    map[from].add("qualified");
  }

  // Employer check resolves forward to qualified or bounces back for
  // clarification / re-contact.
  map.employer_pending.add("qualified");
  map.employer_pending.add("eligibility_unclear");
  map.employer_pending.add("interested");

  // Phase chain: each phase only advances to the next (edges derived from the
  // canonical order, never re-listed).
  for (let i = 0; i < PHASE_CHAIN.length - 1; i += 1) {
    map[PHASE_CHAIN[i]].add(PHASE_CHAIN[i + 1]);
  }

  // `lost` escape hatch from every non-terminal status.
  for (const status of PIPELINE_STATUS_ORDER) {
    if (status !== LOST) map[status].add(LOST);
  }

  return map as Record<ParticipantStatus, ReadonlySet<ParticipantStatus>>;
}

export const ALLOWED_PARTICIPANT_TRANSITIONS: Record<
  ParticipantStatus,
  ReadonlySet<ParticipantStatus>
> = buildAllowedMap();

/**
 * Pure predicate over the allowed-transition map — the single source of
 * participant transition truth. A no-op (from === to) is always allowed so the
 * caller's early-return stays consistent.
 */
export function isParticipantTransitionAllowed(
  from: ParticipantStatus,
  to: ParticipantStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_PARTICIPANT_TRANSITIONS[from]?.has(to) ?? false;
}

export class ParticipantTransitionError extends Error {
  constructor(
    public readonly from: ParticipantStatus,
    public readonly to: ParticipantStatus,
  ) {
    super(`Statuswechsel ${from} → ${to} ist nicht zulässig.`);
    this.name = "ParticipantTransitionError";
  }
}
