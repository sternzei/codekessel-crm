import type { TaskLinkState } from "./service";

// Derives what a consultant sees for a task's magic-link credential. A live
// link always wins the display (even if older ones were revoked); otherwise a
// prior revoke/supersede is surfaced so an invalidated link is visible.
export type TaskLinkDisplayStatus = "active" | "revoked" | "none";

/** Pure mapping from a token-state snapshot to the internal display status. */
export function deriveTaskLinkDisplayStatus(
  state: TaskLinkState,
): TaskLinkDisplayStatus {
  if (state.hasLiveLink) return "active";
  if (state.revokedLinkCount > 0) return "revoked";
  return "none";
}
