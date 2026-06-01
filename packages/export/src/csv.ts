/**
 * CSV writer compliant with RFC 4180.
 *
 * Quoting rules:
 *   - Fields containing comma, quote, CR, or LF MUST be quoted.
 *   - Quotes inside a quoted field are doubled.
 *   - Lines are CRLF-terminated.
 *
 * Avoiding a third-party CSV dep means a reviewer can audit exactly
 * what we emit; FOCUS dashboards are picky and a malformed CSV breaks
 * downstream ingest silently.
 */

function needsQuoting(s: string): boolean {
  return s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r");
}

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Objects (e.g. FOCUS Tags) → JSON, then escape.
  let s: string;
  if (typeof value === "object") {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  if (needsQuoting(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Render `rows` as RFC-4180 CSV with `columns` as the header. */
export function rowsToCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: ReadonlyArray<keyof T & string>
): string {
  const header = columns.map((c) => escapeField(c)).join(",");
  const lines = rows.map((r) =>
    columns.map((c) => escapeField(r[c])).join(",")
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}
