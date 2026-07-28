export type PollDelayParams = {
  /** Base poll interval in milliseconds. */
  readonly baseMs: number;
  /** Maximum extra random delay in milliseconds (0 disables jitter). */
  readonly maxJitterMs: number;
  /** Injectable RNG for deterministic tests; defaults to Math.random. */
  readonly random?: () => number;
};

/**
 * Compute the next poll delay: the base interval plus a small random jitter.
 * Jitter de-synchronizes multiple worker replicas so they don't stampede the
 * queue on the same tick.
 */
export function computePollDelay(params: PollDelayParams): number {
  const random = params.random ?? Math.random;
  const jitter = Math.floor(random() * Math.max(0, params.maxJitterMs));
  return params.baseMs + jitter;
}
