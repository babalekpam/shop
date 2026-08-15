/**
 * Pointer velocity, measured over a trailing window.
 *
 * The naive implementation — deltaPosition / deltaTime between the last two pointer
 * events — is the usual reason a flick "sometimes rockets off". Pointer events arrive
 * irregularly; a single 2ms gap with 3px of jitter reports 1500px/s from a stationary
 * finger. Averaging over a short trailing window is stable without feeling laggy.
 *
 * See docs/design-system.md §2.3 and .claude/skills/apple-design/SKILL.md §2 and §5.
 */

interface Sample {
  position: number;
  time: number;
}

/** Trailing window in ms. Long enough to reject jitter, short enough to stay current. */
export const DEFAULT_VELOCITY_WINDOW = 100;

export class VelocityTracker {
  private samples: Sample[] = [];

  constructor(private readonly windowMs: number = DEFAULT_VELOCITY_WINDOW) {}

  /** Record a position. `time` should come from the event's `timeStamp`. */
  sample(position: number, time: number): void {
    this.samples.push({ position, time });
    this.prune(time);
  }

  /**
   * Velocity in px/s over the trailing window, or 0 if there is not enough signal.
   *
   * Zero on an ambiguous release is the right default: it falls through to a
   * position-based decision rather than throwing the element somewhere arbitrary.
   */
  velocity(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const elapsed = last.time - first.time;
    if (elapsed <= 0) return 0;
    return ((last.position - first.position) / elapsed) * 1000;
  }

  /** The most recent position, or undefined if nothing has been sampled. */
  latest(): number | undefined {
    return this.samples[this.samples.length - 1]?.position;
  }

  reset(): void {
    this.samples = [];
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    // Always keep at least two samples, so a slow drag that produces one event per
    // window still reports a velocity rather than silently returning 0.
    while (this.samples.length > 2 && this.samples[0]!.time < cutoff) {
      this.samples.shift();
    }
  }
}
