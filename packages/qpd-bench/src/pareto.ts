/**
 * F4 — Pareto frontier over (cost, quality) points.
 *
 * A model configuration is Pareto-dominated when another configuration is no
 * more expensive AND no lower quality, with at least one strict improvement.
 * The frontier is the set of non-dominated points — the only configurations
 * worth considering. Pure geometry; no statistics here (the recommender adds
 * the significance gate on top).
 */

export interface ParetoPoint {
  model: string;
  /** Mean cost per task (USD). Lower is better. */
  cost: number;
  /** Quality in [0,1] (e.g. acceptance rate). Higher is better. */
  quality: number;
}

export interface ParetoClassified extends ParetoPoint {
  onFrontier: boolean;
  /** Models that strictly dominate this one (empty if on the frontier). */
  dominatedBy: string[];
}

/**
 * Classify every point as on/off the cost↓ quality↑ Pareto frontier.
 */
export function classifyPareto(points: ParetoPoint[]): ParetoClassified[] {
  return points.map((p) => {
    const dominators = points.filter((q) => q !== p && dominates(q, p));
    return {
      ...p,
      onFrontier: dominators.length === 0,
      dominatedBy: dominators.map((d) => d.model),
    };
  });
}

/** The frontier points only, sorted by ascending cost. */
export function paretoFrontier(points: ParetoPoint[]): ParetoPoint[] {
  return classifyPareto(points)
    .filter((p) => p.onFrontier)
    .sort((a, b) => a.cost - b.cost)
    .map(({ model, cost, quality }) => ({ model, cost, quality }));
}

/**
 * Does `a` dominate `b`? a.cost ≤ b.cost AND a.quality ≥ b.quality, with at
 * least one strict. Ties on both coordinates are NOT domination (neither
 * dominates), so identical points both stay on the frontier.
 */
export function dominates(a: ParetoPoint, b: ParetoPoint): boolean {
  const noWorse = a.cost <= b.cost && a.quality >= b.quality;
  const strictlyBetter = a.cost < b.cost || a.quality > b.quality;
  return noWorse && strictlyBetter;
}
