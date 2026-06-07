/**
 * @prune/futures-desk (F16)
 *
 * Token pre-commitment / futures desk: price non-urgent reservations on the
 * discounted slow lane vs interactive, capturing the caller-supplied published
 * Batch discount. Deterministic eligibility; honest pricing (null on unpriced).
 */

export {
  priceReservations,
  type Reservation,
  type FuturesOptions,
  type Lane,
  type FuturesQuote,
  type FuturesReport,
} from "./futures.js";
