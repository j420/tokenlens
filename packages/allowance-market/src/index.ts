/**
 * @prune/allowance-market (F15)
 *
 * Personal tradeable allowance market: split a shared envelope into owned,
 * transferable per-actor allowances (Coasean). Pure operations over an
 * immutable state; overdraws are rejected, never clamped. No fabricated numbers.
 */

export {
  emptyMarket,
  allocate,
  spend,
  transfer,
  balance,
  balances,
  type Allowance,
  type MarketState,
  type AllocateActor,
  type OpResult,
  type Balance,
} from "./market.js";
