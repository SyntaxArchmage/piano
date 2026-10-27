/** Redact secret-shaped values from exported payloads.
 *
 * Local transcripts stay unmasked — they are the evidence. Only what leaves
 * the machine through Langfuse is masked. */

const SECRET_KEY = /api[_-]?key|authorization|secret|password|credential|token/i;
const SECRET_VALUE = /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{6,}\b/g;
const REDACTED = "[redacted]";

function maskString(value: string): string {
  return value.replace(SECRET_VALUE, REDACTED);
}

function maskValue(value: unknown, key?: string, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (key !== undefined && SECRET_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return maskString(value);
  if (Array.isArray(value)) return value.map((item) => maskValue(item, undefined, depth + 1));
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(source)) {
      out[name] = maskValue(item, name, depth + 1);
    }
    return out;
  }
  return value;
}

/** `LangfuseSpanProcessor` mask hook: sees one decoded value at a time. */
export function maskLangfusePayload(params: { data: unknown }): unknown {
  return maskValue(params.data);
}
