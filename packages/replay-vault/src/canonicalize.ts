/**
 * Deterministic JSON canonicalization — a minimal RFC 8785 (JCS) impl.
 *
 * Why this matters for the replay vault: the audit-log integrity story
 * rests on "same input → same hash". JSON.stringify is not deterministic
 * (object key order is implementation-defined; number formatting can
 * round-trip with precision drift). RFC 8785 specifies a canonical form
 * that two compliant impls will agree on.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc8785
 *
 * Scope of this impl (enough for audit-log payloads — JSON only):
 *   - Object keys sorted by code-unit order
 *   - Arrays preserved in source order
 *   - Strings: JSON escape rules per RFC 8259 + the JCS minimum-escape policy
 *   - Numbers: ECMAScript ToString rules (the JCS number serialization
 *     specifies a subset; we use Number.prototype.toString which matches
 *     for integers and most non-exponential decimals — flagged below
 *     for anyone auditing this for full-spec compliance)
 *   - Booleans, null, undefined → JSON literals (undefined is skipped
 *     in objects and rendered as null in arrays, matching JSON.stringify)
 *
 * Hard rule: no third-party canonicalizer. Reviewer reads this file
 * and sees exactly what's signed.
 */

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [k: string]: CanonicalValue };

function escapeString(s: string): string {
  // JCS minimum-escape policy: only control chars (U+0000..U+001F),
  // U+0022 ("), and U+005C (\) require escaping. All others render literal.
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += s[i];
  }
  out += '"';
  return out;
}

function serializeNumber(n: number): string {
  // Reject non-finite numbers per JSON spec.
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot canonicalize non-finite number: ${n}`);
  }
  // Number.prototype.toString matches the JCS serialization for integers
  // and for non-exponential decimals. Negative zero is normalized to 0
  // per JCS §3.2.2.3.
  if (Object.is(n, -0)) return "0";
  return n.toString();
}

function canonicalizeValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return serializeNumber(v);
  if (typeof v === "string") return escapeString(v);
  if (Array.isArray(v)) {
    const parts = v.map((x) => canonicalizeValue(x === undefined ? null : x));
    return "[" + parts.join(",") + "]";
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort(); // RFC 8785 §3.2.3 — sort by UTF-16 code-unit order
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(escapeString(k) + ":" + canonicalizeValue(o[k]));
    }
    return "{" + parts.join(",") + "}";
  }
  // Symbols, functions, bigints — out of scope; throw rather than silently
  // produce a hash that doesn't represent the real payload.
  throw new Error(`Cannot canonicalize value of type ${typeof v}`);
}

/**
 * Canonicalize an arbitrary JSON-compatible value into the unique
 * RFC 8785 JCS form. Throws on inputs that aren't JSON-representable.
 */
export function canonicalize(value: unknown): string {
  return canonicalizeValue(value);
}
