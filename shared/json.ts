export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse untrusted text into a JsonValue, or null if it is not valid JSON. */
export function parseJson(raw: string): JsonValue | null {
  try {
    const parsed: JsonValue = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}
