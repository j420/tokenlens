/**
 * @prune/response-tuner
 *
 * Output-side token reduction for the Token-Cost Reduction Program (TCRP).
 *
 * Two independent, pure, deterministic tools:
 *
 *   1. Tool-Result Sub-Token Pruner (`./result-pruner.js`)
 *      Shrinks the token cost of a large tool RESULT string (file dumps,
 *      grep/log output, JSON blobs) by layered, fully-accounted reduction:
 *      identical-run collapse, blank-run collapse, opaque-blob collapse
 *      (char-set scan, not regex), trailing-whitespace strip, and head/tail
 *      middle elision. Real token counts via @prune/tokenizer; every byte
 *      dropped is recorded in a manifest.
 *
 *   2. max_tokens Calibrator (`./max-tokens-calibrator.js`)
 *      Recommends a `max_tokens` reservation from observed output-length
 *      samples using nearest-rank quantiles plus a safety margin, and reports
 *      truncation rates and over-reservation. Returns `insufficient_data`
 *      rather than guessing when samples are too few.
 *
 * Neither module talks to a model or mutates global state; both return
 * well-formed neutral results on garbage input and never throw.
 */

export * from "./result-pruner.js";
export * from "./max-tokens-calibrator.js";
