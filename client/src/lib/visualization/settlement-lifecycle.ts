/**
 * Pure logic for settlement temporal lifecycle animations.
 * Determines visibility and animation phase based on current year.
 */

export type SettlementLifecyclePhase =
  | 'hidden'       // before founded or after abandoned
  | 'founding'     // fade-in transition window
  | 'active'       // fully visible
  | 'abandoning'   // fade-out transition window
  | 'destroyed';   // brief burst then hidden

export const TRANSITION_YEARS = 50; // years over which fade-in/out occurs
export const BURST_YEARS = 20;      // years the destruction burst is visible

/**
 * Determine the lifecycle phase and a 0-1 visibility factor for a settlement
 * at the given year.
 */
export function getLifecycleState(
  foundedYear: number | null,
  abandonedYear: number | null,
  currentYear: number,
): { phase: SettlementLifecyclePhase; visibility: number } {
  // No founding date — always visible (undated settlement)
  if (foundedYear === null) {
    return { phase: 'active', visibility: 1 };
  }

  // Before founding
  if (currentYear < foundedYear) {
    return { phase: 'hidden', visibility: 0 };
  }

  // Founding transition window
  if (currentYear < foundedYear + TRANSITION_YEARS) {
    const progress = (currentYear - foundedYear) / TRANSITION_YEARS;
    return { phase: 'founding', visibility: progress };
  }

  // No abandonment — stays active forever
  if (abandonedYear === null) {
    return { phase: 'active', visibility: 1 };
  }

  // Active period
  if (currentYear < abandonedYear - TRANSITION_YEARS) {
    return { phase: 'active', visibility: 1 };
  }

  // Abandoning transition window
  if (currentYear < abandonedYear) {
    const progress = (abandonedYear - currentYear) / TRANSITION_YEARS;
    return { phase: 'abandoning', visibility: progress };
  }

  // Destruction burst window
  if (currentYear < abandonedYear + BURST_YEARS) {
    return { phase: 'destroyed', visibility: 0.8 };
  }

  // After destruction burst — hidden
  return { phase: 'hidden', visibility: 0 };
}

/**
 * Compute a pulsing multiplier for capital cities (sin wave oscillation).
 * Returns a value between 0.7 and 1.0 for visual pulsing.
 * When reducedMotion is true, returns a constant 1.0.
 */
export function capitalPulse(currentYear: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1.0;
  const t = (currentYear % 100) / 100;
  return 0.85 + 0.15 * Math.sin(t * Math.PI * 2);
}
