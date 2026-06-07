/**
 * Personal Tradeable Allowance Market  (F15)
 * ==========================================
 * budget-gate is ONE shared cap: below it the marginal token is free to the
 * actor who spends it (the externality — spender ≠ payer). This installs a
 * Coasean market: the shared envelope is split into OWNED, visible, transferable
 * per-actor allowances, so each actor faces a personal opportunity cost and a
 * dev who needs more must TRADE for it (making the cost legible).
 *
 * All operations are PURE functions over an immutable `MarketState`. Amounts
 * (tokens or USD — the unit is the caller's) are caller-supplied; nothing is
 * fabricated. A spend or transfer that would overdraw is REJECTED (ok:false),
 * never silently clamped — the cap is real. Deterministic, total, no regex.
 */

// ============================================================================
// Types
// ============================================================================

export interface Allowance {
  /** Total allowance owned (after any transfers). */
  granted: number;
  /** Amount already spent. */
  spent: number;
}

export interface MarketState {
  version: 1;
  /** actorId → allowance. */
  actors: Record<string, Allowance>;
}

export interface AllocateActor {
  actorId: string;
  /** Relative weight for a weighted split. Default 1 (equal split). */
  weight?: number;
}

export interface OpResult {
  ok: boolean;
  state: MarketState;
  reason?: string;
}

// ============================================================================
// Construction
// ============================================================================

export function emptyMarket(): MarketState {
  return { version: 1, actors: {} };
}

/**
 * Split `envelope` across actors by weight (equal when weights are omitted).
 * Deterministic: the remainder from integer division is handed to actors in
 * sorted-id order, one unit each, so the split is exact and reproducible.
 */
export function allocate(envelope: unknown, actors: unknown): MarketState {
  // Floor to an integer unit so the remainder distribution below is EXACT. A
  // fractional envelope (a non-integer USD figure) would make the unit-by-unit
  // remainder loop overshoot and leak the cap; allowances are whole units.
  const env = Math.floor(nonNegNum(envelope));
  const list: AllocateActor[] = Array.isArray(actors)
    ? (actors.filter(isAllocateActor) as AllocateActor[])
    : [];
  const state = emptyMarket();
  if (list.length === 0 || env <= 0) return state;

  // De-dup by id (first weight wins), sort for a deterministic remainder pass.
  const byId = new Map<string, number>();
  for (const a of list) {
    if (!byId.has(a.actorId)) byId.set(a.actorId, posNum(a.weight, 1));
  }
  const ids = [...byId.keys()].sort();
  const totalWeight = ids.reduce((s, id) => s + byId.get(id)!, 0);

  // Floor each share, then distribute the leftover unit-by-unit by sorted id so
  // the sum is EXACTLY the envelope (no rounding loss, no fabrication).
  const shares = ids.map((id) => Math.floor((env * byId.get(id)!) / totalWeight));
  let distributed = shares.reduce((a, b) => a + b, 0);
  let leftover = env - distributed;
  let i = 0;
  while (leftover > 0 && ids.length > 0) {
    shares[i % ids.length] += 1;
    leftover -= 1;
    i += 1;
  }
  ids.forEach((id, idx) => {
    state.actors[id] = { granted: shares[idx]!, spent: 0 };
  });
  return state;
}

// ============================================================================
// Operations (pure; reject on overdraw)
// ============================================================================

export function spend(state: unknown, actorId: string, amount: unknown): OpResult {
  const s = coerce(state);
  const amt = nonNegNum(amount);
  const a = s.actors[actorId];
  if (!a) return { ok: false, state: s, reason: `unknown actor "${actorId}"` };
  if (amt <= 0) return { ok: false, state: s, reason: "amount must be positive" };
  if (a.spent + amt > a.granted) {
    return {
      ok: false,
      state: s,
      reason: `overdraw: ${actorId} has ${a.granted - a.spent} left, tried to spend ${amt}`,
    };
  }
  const next = clone(s);
  next.actors[actorId] = { granted: a.granted, spent: a.spent + amt };
  return { ok: true, state: next };
}

/** Coasean trade: move unspent allowance from one actor to another. */
export function transfer(state: unknown, fromId: string, toId: string, amount: unknown): OpResult {
  const s = coerce(state);
  const amt = nonNegNum(amount);
  const from = s.actors[fromId];
  const to = s.actors[toId];
  if (!from) return { ok: false, state: s, reason: `unknown sender "${fromId}"` };
  if (!to) return { ok: false, state: s, reason: `unknown recipient "${toId}"` };
  if (fromId === toId) return { ok: false, state: s, reason: "cannot transfer to self" };
  if (amt <= 0) return { ok: false, state: s, reason: "amount must be positive" };
  if (from.granted - from.spent < amt) {
    return {
      ok: false,
      state: s,
      reason: `insufficient balance: ${fromId} has ${from.granted - from.spent}, tried to send ${amt}`,
    };
  }
  const next = clone(s);
  next.actors[fromId] = { granted: from.granted - amt, spent: from.spent };
  next.actors[toId] = { granted: to.granted + amt, spent: to.spent };
  return { ok: true, state: next };
}

// ============================================================================
// Queries
// ============================================================================

export interface Balance {
  actorId: string;
  granted: number;
  spent: number;
  remaining: number;
  /** spent / granted in [0,1]; 0 when granted is 0. */
  utilization: number;
}

export function balance(state: unknown, actorId: string): Balance | null {
  const s = coerce(state);
  const a = s.actors[actorId];
  if (!a) return null;
  return {
    actorId,
    granted: a.granted,
    spent: a.spent,
    remaining: a.granted - a.spent,
    utilization: a.granted > 0 ? a.spent / a.granted : 0,
  };
}

export function balances(state: unknown): Balance[] {
  const s = coerce(state);
  return Object.keys(s.actors)
    .sort()
    .map((id) => balance(s, id)!)
    .filter((b): b is Balance => b !== null);
}

// ============================================================================
// Helpers
// ============================================================================

function coerce(state: unknown): MarketState {
  const out = emptyMarket();
  if (!state || typeof state !== "object") return out;
  const s = state as Partial<MarketState>;
  if (!s.actors || typeof s.actors !== "object") return out;
  for (const [id, raw] of Object.entries(s.actors)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<Allowance>;
    if (
      typeof r.granted === "number" &&
      Number.isFinite(r.granted) &&
      typeof r.spent === "number" &&
      Number.isFinite(r.spent)
    ) {
      out.actors[id] = { granted: Math.max(0, r.granted), spent: Math.max(0, r.spent) };
    }
  }
  return out;
}

function clone(s: MarketState): MarketState {
  return { version: 1, actors: { ...mapVals(s.actors) } };
}

function mapVals(actors: Record<string, Allowance>): Record<string, Allowance> {
  const out: Record<string, Allowance> = {};
  for (const [k, v] of Object.entries(actors)) out[k] = { granted: v.granted, spent: v.spent };
  return out;
}

function isAllocateActor(v: unknown): v is AllocateActor {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return typeof a.actorId === "string" && a.actorId.length > 0;
}

function nonNegNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function posNum(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : dflt;
}
