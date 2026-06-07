/**
 * Deterministic canonical serialization. The signature must be over a byte
 * string that is identical for identical content regardless of key insertion
 * order, so we recursively sort object keys and emit compact JSON. This is what
 * makes the attestation tamper-evident: any change to the manifest changes the
 * canonical bytes, which invalidates the signature.
 *
 * Pure and total. No regex. Non-finite numbers are rejected (they have no stable
 * JSON form) by throwing — callers pass finite, measured magnitudes.
 */

type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json };

export function canonicalize(value: unknown): string {
  return encode(value as Json);
}

function encode(value: Json): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("canonicalize: non-finite number is not serializable");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) {
        return "[" + value.map(encode).join(",") + "]";
      }
      return encodeObject(value as { [k: string]: Json });
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

function encodeObject(obj: { [k: string]: Json }): string {
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue; // undefined fields are omitted, deterministically
    parts.push(JSON.stringify(k) + ":" + encode(v));
  }
  return "{" + parts.join(",") + "}";
}
