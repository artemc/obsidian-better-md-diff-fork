/** The interface is English only; `t` fills `{name}` placeholders in UI text. */
export function t(text: string, values: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (match: string, name: string) => values[name] === undefined ? match : String(values[name]));
}

/** A user-facing error whose message is UI text with placeholders. */
export class LocalizedError extends Error {
  constructor(text: string, values: Record<string, string | number> = {}) { super(t(text, values)); }
}
