/**
 * Replay guard — the safety gate before a skill is offered for reuse.
 *
 * A skill captured last week may reference files that have since moved or
 * changed. Replaying it blindly would point the agent at stale targets. The
 * guard compares the host's CURRENT freshness tokens against the ones recorded
 * at capture: any target whose token changed (or is now missing) marks the
 * skill unsafe, and the caller falls back to normal discovery.
 *
 * This is the "stale skill → fall back" path that makes the whole feature
 * safe-by-construction: the worst a bad skill can do is get declined here.
 */

import type { ReplayGuardResult, ReplayPrecondition, Skill } from "./types.js";

/**
 * Evaluate whether a skill is safe to replay given the host's current freshness
 * preconditions and the preconditions captured with the skill.
 *
 * Pure. A target is:
 *   - STALE         if both captured and current tokens exist but differ.
 *   - UNVERIFIABLE  if the current token is missing (host couldn't probe it).
 *                   By default unverifiable ⇒ unsafe (conservative); set
 *                   `allowUnverifiable` to treat missing probes as a pass.
 *
 * A skill with no targets at all (pure-reasoning skill) is always safe.
 */
export function evaluateReplay(
  skill: Skill,
  capturedPreconditions: readonly ReplayPrecondition[],
  currentPreconditions: readonly ReplayPrecondition[],
  options: { allowUnverifiable?: boolean } = {}
): ReplayGuardResult {
  const allowUnverifiable = options.allowUnverifiable ?? false;
  const captured = new Map<string, string>();
  for (const p of capturedPreconditions) captured.set(p.target, p.freshnessToken);
  const current = new Map<string, string>();
  for (const p of currentPreconditions) current.set(p.target, p.freshnessToken);

  const targets = new Set<string>();
  for (const step of skill.steps) {
    if (step.target !== null) targets.add(step.target);
  }

  const staleTargets: string[] = [];
  const unverifiableTargets: string[] = [];

  for (const target of targets) {
    const capturedToken = captured.get(target);
    const currentToken = current.get(target);
    if (capturedToken === undefined) {
      // No baseline to compare against — treat as unverifiable.
      unverifiableTargets.push(target);
      continue;
    }
    if (currentToken === undefined) {
      unverifiableTargets.push(target);
      continue;
    }
    if (capturedToken !== currentToken) {
      staleTargets.push(target);
    }
  }

  staleTargets.sort();
  unverifiableTargets.sort();

  const unsafeFromUnverifiable = !allowUnverifiable && unverifiableTargets.length > 0;
  const safe = staleTargets.length === 0 && !unsafeFromUnverifiable;

  let reason: string | null = null;
  if (!safe) {
    const parts: string[] = [];
    if (staleTargets.length > 0) {
      parts.push(`${staleTargets.length} target(s) changed since capture: ${staleTargets.join(", ")}`);
    }
    if (unsafeFromUnverifiable) {
      parts.push(
        `${unverifiableTargets.length} target(s) could not be verified: ${unverifiableTargets.join(", ")}`
      );
    }
    reason = `Skill ${skill.id} unsafe to replay — ${parts.join("; ")}. Falling back to discovery.`;
  }

  return { safe, staleTargets, unverifiableTargets, reason };
}
